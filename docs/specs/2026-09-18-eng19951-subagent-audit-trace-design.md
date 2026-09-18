# ENG-19951: Subagent tool evidence goes missing from the parent's audit trace

**Ticket:** [ENG-19951](https://linear.app/getboon/issue/ENG-19951) — Agent audit trace drops tool items on long turns; Message-only trajectories turn grounded replies into fabrication judge failures.
**Status:** design approved by ticket owner, ready for `writing-plans`.
**Branch:** `fix/eng-19951-subagent-audit-trace` (worktree off `origin/boon`, boon.45 base).

## 1. Problem

When a parent agent delegates work to a spawned subagent (`sessions_spawn` +
`sessions_yield`), and the subagent genuinely runs tools to do that work, the
**parent's own delivered reply** — the one the user or an eval judge actually
sees — can carry an `audit_trace` showing **zero tool invocations**, even
though the underlying work is proven (e.g. against a production database) to
have happened. This causes eval judges to flag real, grounded results as
"fabricated."

Root cause, confirmed against the `getboon/openclaw` fork source and live
production logs (see linked RCA on the ticket): `attachAgentDecisionTrace`
(`src/auto-reply/reply/agent-runner.ts:2423`) builds the delivered reply's
`audit_trace` from `runResult.meta.toolSummary` alone — which is
`attemptToolSummary`, computed per-attempt from `attempt.toolMetas`
(`src/agents/embedded-agent-runner/run.ts:3739`). When a parent yields waiting
on a subagent, the attempt that resumes and composes the final reply is a
**fresh embedded-run attempt** with its own, freshly-initialized
`attempt.toolMetas` — nothing carries the subagent's tool-call evidence
forward into it. The subagent's own reply already has a correct,
non-empty `audit_trace` (it went through the identical trace-building code
for its own turn) — but that evidence never crosses back to the parent.

## 2. Goal

Make the parent's delivered reply carry the completing subagent's tool
evidence in its own `audit_trace`, so the trace reflects work that was
genuinely delegated and genuinely happened — **without changing behavior for
any turn that doesn't involve subagent delegation**, and without inventing
new failure modes for restart/orphan/multi-child cases that don't exist today.

**Explicitly out of scope** (see design-log below for why):

- Un-suppressing/wiring a live "thinking" progress lane for a waiting child
  into the parent's channel UI. Investigated and dropped: it's not what's
  broken (nothing is suppressed today — the child simply runs a separate,
  unwired progress stream), it's not in the ticket's test plan, and the
  channel already ships a satisfying interim acknowledgement
  (`anychat-boon-web` commit `9406107`, merged 2026-09-11) independent of
  this fix.
- Recovering tool calls the **parent itself** made in the few seconds right
  before calling `sessions_yield` (currently correctly computed but never
  delivered anywhere, since a yielding attempt ends with zero payloads and
  nothing today persists that value across the wait). Real gap, but not
  present in the ticket's proven case, and it requires new persistent state
  with its own lifecycle — tracked as a separate follow-up ticket, not
  bundled here.

## 3. Design

### 3.1 Where evidence is captured: at subagent completion, alongside the existing text capture

`freezeRunResultAtCompletion` (`src/agents/subagent-registry-lifecycle.ts:399`)
is the single place a subagent's final text gets captured and frozen onto its
registry row, via `params.captureSubagentCompletionReply(...)` →
`captureSubagentCompletionReplyUsing` (`subagent-announce-capture.ts:38`) →
`readSubagentOutput` (`subagent-announce-output.ts:225`), which scans the
child's transcript (`summarizeSubagentOutputHistory`) and extracts plain text
via `selectSubagentOutputText`. **Today this only ever extracts text — the
transcript messages it scans are never inspected for their `auditTrace`
field**, even though the child's own final assistant message already carries
one (attached by the same unmodified `attachAgentDecisionTrace` call every
reply goes through).

Change: extend this same scan to also extract the `auditTrace` off the exact
message `selectSubagentOutputText` selects as the winning text — same
message, same pass, no second transcript read. Concretely:

- `summarizeSubagentOutputHistory` gains a parallel `latestAuditTrace` field
  on `SubagentOutputSnapshot`, set whenever `latestAssistantText` is set
  (same branch, same message).
- A new sibling function, `readSubagentOutputWithTrace`, wraps the same
  internal scan and returns `{ text?: string; auditTrace?: AgentDecisionTrace
}` instead of just `string | undefined`. **The existing exported
  `readSubagentOutput` is untouched — same signature, same behavior, same
  callers, zero risk to anything that isn't this fix.** `readSubagentOutput`
  becomes a one-line wrapper around the new richer internal function that
  drops the trace field, preserving its exact current contract.
- `captureSubagentCompletionReply` gets an analogous
  `captureSubagentCompletionReplyWithTrace` sibling (same
  wrap-and-drop-the-extra-field relationship to the existing function).

### 3.2 Where evidence is frozen: a new field alongside `completion.resultText`

`SubagentCompletionState` (`subagent-registry.types.ts:39`) gains
`resultAuditTrace?: AgentDecisionTrace`, frozen in `freezeRunResultAtCompletion`
in the same call that sets `completion.resultText`, using
`captureSubagentCompletionReplyWithTrace` instead of the text-only version.
`PendingFinalDeliveryPayload` (`subagent-registry.types.ts:11`) gets the
matching `frozenAuditTrace?: AgentDecisionTrace`, mirroring how
`frozenResultText` is already carried there — same pattern, same file, same
two call sites in `subagent-registry-lifecycle.ts` (~546, ~581) that already
build this payload from `completion.resultText`.

This is purely additive: a new optional field with a producer and no existing
readers. Nothing that reads `SubagentCompletionState`/`PendingFinalDeliveryPayload`
today changes behavior because it simply never looks at a field it doesn't
know exists.

### 3.3 Where evidence enters the completion event: `AgentTaskCompletionInternalEvent`

`AgentTaskCompletionInternalEvent` (`src/agents/internal-events.ts:23`) gains
an optional `childToolEvidence?: SubagentToolEvidence[]` field — an **array**
from the start, not a single value, so the single-child and multi-child-wake
cases use one shape (see 3.5). `SubagentToolEvidence` is a small new type:

```ts
type SubagentToolEvidence = {
  childSessionKey: string;
  toolInvocations: AgentDecisionTrace["toolInvocations"];
  visibleTools: string[];
};
```

Only `toolInvocations` and `visibleTools` — confirmed by reading
`agent-decision-trace.ts` that `AgentDecisionTrace.evidence` is not an input
anywhere; it's derived unconditionally inside `buildAgentDecisionTrace` as
`toolInvocations.map(...)`. Carrying a separate `evidence` array here would
be redundant at best and a source of a parent/child mismatch at worst (if the
two arrays ever disagreed, which of the two would be haunted). There's
nothing to merge for `evidence` — it falls out correctly once `toolInvocations`
is merged.

`formatTaskCompletionEvent`/`formatAgentInternalEventsForPrompt` (same file)
are **not modified** — this field is never rendered into the LLM-facing prompt
text; it travels alongside the event for code to consume, not for the model to
read. Zero risk of changing what the parent LLM sees in its own context.

In `runSubagentAnnounceFlow` (`src/agents/subagent-announce.ts`), where
`completionEvent: AgentInternalEvent` is constructed (~line 531), populate
`childToolEvidence` from whichever source supplied `reply`/`findings`:

- Single-child path: from the registry's frozen `completion.resultAuditTrace`
  (read via the same registry accessor already used to read
  `completion.resultText` for this run) when the `reply` came from the frozen
  freeze path, or from a live `readSubagentOutputWithTrace` call when it came
  from the live-read fallback branches (~lines 409/413).
- Multi-child wake path (`childCompletionFindings`, built by
  `buildChildCompletionFindings` from `directChildren` registry rows): each
  row already carries what becomes `frozenResultText` — add the matching
  `frozenAuditTrace` (3.2) to the same row shape `buildChildCompletionFindings`
  consumes, and collect one `SubagentToolEvidence` entry per child with usable
  evidence into the array, in the same order `buildChildCompletionFindings`
  already sorts them.

### 3.4 Where evidence crosses into the parent's trace: `agent-runner.ts`, additive merge

Confirmed the structured `internalEvents` array (not just its rendered text)
is **already threaded through as a param** on the dispatch call that resumes
the parent (`subagent-announce-delivery.ts:1529`,
`directAgentParams.internalEvents: params.internalEvents`), tagged via the
same call's `inputProvenance.sourceTool` (default `"subagent_announce"`,
`subagent-announce-delivery.ts:1546`) — this repo already has a working
precedent for "this resumed run carries internal-event context" (the
steering path, `maybeSteerSubagentAnnounce`, carries it the analogous way for
a live/steered resume rather than a fresh dispatch).

Remaining work, confirmed as a code-reading task rather than a design
decision (no tradeoffs — just need to trace the last hop precisely at
implementation time): follow `internalEvents` from the `agent` gateway
method's params through `attempt-execution.shared.ts` (confirmed it already
consumes `events`/`AgentInternalEvent[]` to build prompt text via
`formatAgentInternalEventsForPrompt`/`formatAgentInternalEventsForPlainPrompt`,
lines ~89/102) to wherever the resuming attempt's `runResult.meta` gets
built, and expose the consumed events' `childToolEvidence` arrays there as a
new `runResult.meta.delegatedToolEvidence?: SubagentToolEvidence[]` field
(flattened across all consumed `task_completion` events in this turn).

At the trace-build call site (`agent-runner.ts:2423`), before calling
`buildAgentDecisionTrace`, merge `runResult.meta?.delegatedToolEvidence`
(if present) into the `toolSummary` object passed in:

- Concatenate every entry's `toolInvocations` onto `toolSummary.invocations`
  (the `ToolSummary.invocations` input array `agent-decision-trace.ts` already
  reads and normalizes — confirmed the child's own already-computed
  `AgentDecisionTrace.toolInvocations` entries are shape-identical to this
  input type, both `{name, status, detail?}`, so they pass through the
  existing `normalizeTraceToolName`/`normalizeTraceToolStatus` validation
  unchanged; the merge is a plain array concatenation, not a reshape).
- Union each entry's `visibleTools` into `toolSummary.visibleTools`.
- Tag each merged invocation entry `viaSubagent: true` before concatenating.
  This requires adding `viaSubagent?: boolean` to **three** places in
  `agent-decision-trace.ts`, since each is a separate object-literal
  construction that only carries the fields explicitly listed — none of them
  pass unknown fields through implicitly:
  1. The `ToolSummary.invocations` item type (so a tagged entry can be
     passed in as input).
  2. The output `toolInvocations` entry construction (currently
     `{name, status, ...(detail ? {detail} : {})}`).
  3. The output `evidence` entry construction (currently
     `{kind: "tool_outcome", tool: invocation.name, status: invocation.status,
   ...(detail ? {detail} : {})}`, built by mapping over `toolInvocations` —
     without this third addition, a merged entry would carry `viaSubagent` in
     `toolInvocations` but silently lose it in `evidence`, an inconsistency
     between two views of the same data that's worse than not tagging at all).
     All three additive — ignored by anything that doesn't know the field exists.

No merge target exists for `evidence` (see 3.3) — it's correctly recomputed
by the existing, unmodified `evidence: toolInvocations.map(...)` line once
`toolInvocations` carries the merged set.

**This merge only ever fires when `runResult.meta.delegatedToolEvidence` is
present — which only happens for a reply that resumed after consuming a
`task_completion` event.** An ordinary, non-delegating turn's `runResult.meta`
never has this field, so `buildAgentDecisionTrace`'s inputs are byte-for-byte
identical to today for the overwhelming majority of turns. This is the
concrete mechanism behind the "no regressions for the common case" goal — not
a promise to be careful, but a structural consequence of where the merge is
gated.

### 3.5 Multi-child and nested grandchildren: confirmed free, no extra code

**Multi-child:** `buildDescendantWakeMessage`/`childCompletionFindings`
already aggregate several settled children into one wake. Because
`childToolEvidence` is an array from the start (3.3) and the merge step (3.4)
appends every entry in it, waking on N children merges N children's evidence
in the same pass — no special-casing needed beyond populating the array
correctly in 3.3.

**Nested grandchildren:** confirmed structurally — there is exactly **one**
call site for `attachAgentDecisionTrace`/`buildAgentDecisionTrace` in the
entire repo (`agent-runner.ts:2423`), with no subagent-specific bypass. A
subagent's own run, when it resumes after yielding on its own grandchild,
goes through the identical path and therefore gets the identical merge
applied to **its own** reply before that reply is frozen as `completion.resultAuditTrace`
on its own registry row (3.2). When that subagent's own completion is later
read by the real top-level parent (3.1/3.3), the grandchild's evidence is
already folded in — inherited one hop at a time, with zero recursion code.
Wire size is bounded by the existing `MAX_TRACE_ITEMS = 128` cap already
present in `agent-decision-trace.ts` (`allInvocations.slice(0, MAX_TRACE_ITEMS)`)
— no new cap needed.

### 3.6 Orphaned / interrupted subagent: no new failure mode

If a subagent run is orphaned before ever completing (gateway restart mid-run,
`reconcileOrphanedRun` discards it — `subagent-registry-helpers.ts`), there is
no frozen `completion.resultAuditTrace` to read: 3.3's lookup simply finds
nothing, and the merge in 3.4 has nothing to append. The delivered reply's
trace is exactly what it is **today** in that case (no delegated evidence,
same as the current, unfixed behavior) — this fix can only ever _add_
evidence when it's genuinely available; it introduces no new way to fail.

## 4. Files touched (summary)

| File                                                                                                               | Change                                                                                                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/agents/subagent-announce-output.ts`                                                                           | Add `latestAuditTrace` to `SubagentOutputSnapshot`; add `readSubagentOutputWithTrace`, `captureSubagentCompletionReplyWithTrace` siblings. `readSubagentOutput`/`captureSubagentCompletionReply` unchanged. |
| `src/agents/subagent-registry.types.ts`                                                                            | Add `resultAuditTrace?` to `SubagentCompletionState`; add `frozenAuditTrace?` to `PendingFinalDeliveryPayload`.                                                                                             |
| `src/agents/subagent-registry-lifecycle.ts`                                                                        | `freezeRunResultAtCompletion` (and `refreshFrozenResultFromSession`) also freeze the trace; the two `PendingFinalDeliveryPayload`-building sites also carry `frozenAuditTrace`.                             |
| `src/agents/internal-events.ts`                                                                                    | Add `SubagentToolEvidence` type; add optional `childToolEvidence?` to `AgentTaskCompletionInternalEvent`. No change to prompt rendering.                                                                    |
| `src/agents/subagent-announce.ts`                                                                                  | Populate `childToolEvidence` when building `completionEvent`, for both the single-child and multi-child-findings paths.                                                                                     |
| `src/agents/subagent-announce-output.ts` (`buildChildCompletionFindings` family)                                   | Thread `frozenAuditTrace` through the same row shape already carrying `frozenResultText`, collect into the evidence array.                                                                                  |
| `src/agents/command/attempt-execution.shared.ts` (or wherever the last hop lands — confirm at implementation time) | Expose consumed `task_completion` events' `childToolEvidence` on `runResult.meta.delegatedToolEvidence`.                                                                                                    |
| `src/auto-reply/reply/agent-runner.ts`                                                                             | Before `buildAgentDecisionTrace` (~line 2423), additively merge `runResult.meta?.delegatedToolEvidence` into `toolSummary`, tagging entries `viaSubagent: true`.                                            |
| `src/auto-reply/reply/agent-decision-trace.ts`                                                                     | Add optional `viaSubagent?: boolean` to the invocation/evidence entry types (additive, no logic change).                                                                                                    |

## 5. Testing

- Unit: `summarizeSubagentOutputHistory`/`selectSubagentOutputText` sibling
  extraction returns the correct `auditTrace` for the selected message; a
  message with no trace yields `undefined` (not a crash).
- Unit: `freezeRunResultAtCompletion` freezes `resultAuditTrace` alongside
  `resultText`; an error-outcome run freezes neither (matches existing
  `resultText = null` branch).
- Unit: `buildAgentDecisionTrace` merge — given a `toolSummary` with existing
  direct invocations plus `delegatedToolEvidence` with N more, the result
  contains all of them, delegated ones tagged `viaSubagent: true`, and
  disposition math (`successfulCalls`/`failedCalls`/etc.) counts them the
  same as direct invocations.
- Unit: merge is a no-op when `delegatedToolEvidence` is absent —
  byte-identical `buildAgentDecisionTrace` output to current behavior for a
  representative existing non-delegating test case.
- Integration: reproduce the ticket's proven shape — a parent spawns a
  subagent, the subagent makes real tool calls and replies, the parent
  resumes and answers — assert the parent's final `audit_trace.toolInvocations`
  is non-empty and includes the child's tool names.
- Integration: multi-child wake — two children with distinct tool calls,
  parent wakes once — assert both children's evidence present.
- Integration: orphaned child (simulate `reconcileOrphanedRun`) — assert the
  parent's eventual reply (if any) has the same (empty, for that child) trace
  as current behavior, no crash.
- Regression: run the existing `agent-decision-trace`/`subagent-announce*`
  test suites unmodified — must stay green, since 3.1/3.2/3.3's new functions
  are additive siblings, not edits to tested existing functions.

## 6. Design-log: what was considered and rejected

- **Mutate `attempt.toolMetas` directly during resume** (`run.ts`) — rejected:
  highest blast radius, since that value likely feeds more than trace-building
  in a ~4,000-line function, and mutating it for every attempt processing a
  particular event type is harder to bound than gating a merge at the single
  trace-build call site.
- **Trace-build-time blind registry lookup** ("which children did this
  session recently spawn") — rejected in favor of explicit tagging: blind
  lookup risks matching the wrong turn's children in a session with rapid
  successive delegations; the existing `inputProvenance`/`internalEvents`
  threading already identifies exactly which completion(s) this specific
  resume is for, so use that instead of inferring it.
- **Recovering pre-yield attempt's own tool calls in this same change** —
  deferred to a follow-up ticket: real gap, but requires new persistent state
  (the value is correctly computed today but never delivered anywhere before
  being discarded) with its own lifecycle/cleanup questions, and isn't
  present in this ticket's proven case. Bundling it would mix a
  read-what-already-exists fix with a needs-new-state fix under one change.
- **Live progress-lane wiring for a waiting child** — dropped, not deferred:
  investigated and found nothing is actually suppressed today (a different,
  unrelated signal was mis-identified as the cause during initial research);
  the channel already ships a satisfying interim acknowledgement via
  unrelated, already-merged work; not in the ticket's test plan.
