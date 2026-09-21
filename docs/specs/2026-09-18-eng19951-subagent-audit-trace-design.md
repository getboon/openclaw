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

**No longer out of scope, resolved by the 3.1 redesign below:** an earlier
draft of this doc scoped out `runSubagentAnnounceFlow`'s `roundOneReply`
fast-path as a gap, because the original (abandoned) capture design only
read evidence out of a transcript read that `roundOneReply` bypasses. The
redesigned capture in 3.1 writes the trace to the registry unconditionally,
whenever the child computes any reply — independent of which text-source
later wins in the announce flow — so `roundOneReply` is no longer a gap.

## 3. Design

### 3.1 Where evidence is captured: a direct write when the subagent's own reply is computed

**Revised after discovering, during implementation, that the original
approach below the line cannot work — kept here so the reasoning isn't
lost, since the same mistake is easy to make again.**

~~Original approach (do not implement): read `auditTrace` back off the
child's persisted session transcript, alongside the existing text
capture in `freezeRunResultAtCompletion`.~~ **This is impossible.**
Traced precisely: `auditTrace` is computed and attached to a reply only in
`agent-runner.ts`, immediately before that reply is delivered
(`buildAgentDecisionTrace`/`attachAgentDecisionTrace`, ~line 2420). The
child's local session transcript entry for that same turn is written
**earlier** — inside the embedded-agent-runner, before `agent-runner.ts`
even begins its post-processing (confirmed: `agent-runner.ts` contains zero
transcript-write calls, only reads). The transcript therefore can never
contain `auditTrace` — it's written before that value exists. Reading it
back later, as the original 3.1 planned, would always find nothing.

**Actual mechanism: write the trace directly onto the subagent's registry
row, at the moment it's computed, independent of the later text-capture
freeze.**

`agent-runner.ts` computes `auditTrace` for **every** reply, including a
subagent child's own reply to its own task (child replies flow through the
identical `runReplyAgent`/`agent-runner.ts` path as any top-level reply —
confirmed, single call site, no bypass). At that exact point, add one
narrow, conditional call:

```ts
if (!isHeartbeat) {
  const auditTrace = buildAgentDecisionTrace({ toolSummary, completion, ... });
  finalPayloads = attachAgentDecisionTrace(finalPayloads, auditTrace);
  if (isSubagentSessionKey(sessionKey)) {
    recordSubagentReplyAuditTrace(sessionKey, auditTrace);
  }
}
```

`isSubagentSessionKey` (`src/sessions/session-key-utils.ts:270`, existing,
unmodified) is a cheap string check. `recordSubagentReplyAuditTrace` is a
new, small function in `src/agents/subagent-registry.ts` (alongside
`addSubagentRunForTests`/`releaseSubagentRun`) that looks up the latest
`SubagentRunRecord` for that `childSessionKey` directly against the live
`subagentRuns` map (**not** via `getSubagentRunsSnapshotForRead`, which may
return a `structuredClone`'d snapshot outside test mode — confirmed by
reading its implementation — so writing through it would silently not
persist), sets `entry.completion.resultAuditTrace`, and calls the existing
module-private `persistSubagentRuns()`.

**Ordering, confirmed architecturally, not just assumed:** `agent-runner.ts`
does not itself emit the lifecycle `"end"` signal that later triggers
`completeSubagentRun`/`freezeRunResultAtCompletion` (it only emits
`"fallback"`/`"fallback_cleared"`, both earlier in the same function, before
`auditTrace` is computed). That terminal signal comes from an orchestration
layer that necessarily hasn't observed a result yet — `runReplyAgent`
(`agent-runner.ts`) must return first. So this write structurally precedes
the freeze, every time — no race. And even if it didn't: a plain field-set
of `completion.resultAuditTrace` is independent of
`freezeRunResultAtCompletion`'s own `resultText`-only idempotency guard, so
a late write would still land correctly rather than being silently
dropped.

This eliminates the entire `readSubagentOutputWithTrace`/
`captureSubagentCompletionReplyWithTrace` sibling-function design from the
original 3.1 — nothing needs to read a trace out of a transcript anymore,
because nothing needs to; it's already sitting on the registry row by the
time anything downstream looks for it. `readSubagentOutput`/
`captureSubagentCompletionReply` (text capture) are **completely
unmodified** by this fix.

### 3.2 Where evidence lands, and how it reaches delivery: `completion.resultAuditTrace`, forwarded unchanged

`SubagentCompletionState` (`subagent-registry.types.ts:39`) gains
`resultAuditTrace?: AgentDecisionTrace` — this is exactly the field 3.1's
`recordSubagentReplyAuditTrace` writes. **`freezeRunResultAtCompletion`
itself needs no changes at all** for the trace — it only ever freezes
`resultText`; `resultAuditTrace` was already set (or, for an orphaned child
that never got to reply, was never set) by the time freeze runs, and freeze
simply never touches that field either way.

`PendingFinalDeliveryPayload` (`subagent-registry.types.ts:11`) gets the
matching `frozenAuditTrace?: AgentDecisionTrace`, mirroring how
`frozenResultText` is already carried there — same pattern, same file, same
two call sites in `subagent-registry-lifecycle.ts` (~546, ~581) that already
build this payload from `completion.resultText`; add
`frozenAuditTrace: entry.completion?.resultAuditTrace` (and the
`entry.delivery?.payload?.frozenAuditTrace ??` precedence for the site that
already has that pattern) alongside the existing `frozenResultText` lines.
This is the only touch this section still needs in
`subagent-registry-lifecycle.ts`.

This is purely additive: a new optional field with a producer (3.1) and no
existing readers. Nothing that reads
`SubagentCompletionState`/`PendingFinalDeliveryPayload` today changes
behavior because it simply never looks at a field it doesn't know exists.

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
`childToolEvidence` by reading `completion.resultAuditTrace` off the
registry row — **for both paths, the same field, populated the same way by
3.1, independent of which text-source supplied `reply`**:

- Single-child path: look up the child's registry entry (this function
  already has `subagentRegistryRuntime.getLatestSubagentRunByChildSessionKey`
  in scope for the multi-child case below — reuse it here too) and read
  `entry.completion?.resultAuditTrace`. Note this is now **independent of
  `params.roundOneReply`** — unlike the original (abandoned) 3.1 design,
  which only captured evidence when `reply` came from a transcript read and
  therefore missed the `roundOneReply` fast-path entirely, the registry
  write in 3.1 happens whenever the child computes any reply at all,
  regardless of which text-source later wins. The `roundOneReply` gap noted
  earlier in this doc's Goal section no longer applies — removed there.
- Multi-child wake path (`childCompletionFindings`, built by
  `buildChildCompletionFindings` from `directChildren` registry rows): each
  row already carries what becomes `frozenResultText` — add the matching
  `frozenAuditTrace` (3.2) to the same row shape `buildChildCompletionFindings`
  consumes, and collect one `SubagentToolEvidence` entry per child with usable
  evidence into the array, in the same order `buildChildCompletionFindings`
  already sorts them.

### 3.4 Where evidence crosses into the parent's trace: `run.ts`, right where `attemptToolSummary` is built

**Revised after confirming the exact wiring (this replaces an earlier draft
of this section that planned a new `runResult.meta.delegatedToolEvidence`
field consumed in `agent-runner.ts` — that approach is no longer needed; see
below for why the simpler version is correct and lower-risk).**

Confirmed `internalEvents` is already a first-class parameter on
`RunEmbeddedAgentParams` (`run/params.ts:269`) and is already available,
unmodified, in the exact same top-level `run.ts` function scope where
`attemptToolSummary` is computed (`params.internalEvents`, same function that
contains the `buildTraceToolSummary` call at `run.ts:3739`) — no new plumbing
needed to get the data there at all.

Confirmed `buildTraceToolSummary`'s return type, `ToolSummaryTrace`
(`embedded-agent-runner/types.ts:110`), has an `invocations` field shaped
`{name: string; status: "ok"|"partial"|"error"|"blocked"; detail?: string}[]`
(`run.ts:556-575`) — **shape-identical** to a completed subagent's own
`AgentDecisionTrace.toolInvocations`. This is the same fact the earlier draft
of this section relied on, but it means the merge can happen immediately
after `buildTraceToolSummary` returns, entirely inside `run.ts`, as a plain
array concatenation — no reshape, no new field on `runResult.meta`, and
**no change to `agent-runner.ts` at all** (it already reads
`runResult.meta.toolSummary` and passes it straight to
`buildAgentDecisionTrace`; if `toolSummary.invocations` already contains the
merged set by the time `agent-runner.ts` sees it, there's nothing left for
that layer to do).

Concretely, right after `const attemptToolSummary = buildTraceToolSummary({...})`
(`run.ts:3739`):

```ts
const delegatedInvocations = collectDelegatedToolInvocationsFromInternalEvents(
  params.internalEvents,
);
const mergedAttemptToolSummary =
  delegatedInvocations.invocations.length > 0
    ? {
        ...attemptToolSummary,
        invocations: [
          ...(attemptToolSummary?.invocations ?? []),
          ...delegatedInvocations.invocations,
        ],
        visibleTools: [
          ...new Set([
            ...(attemptToolSummary?.visibleTools ?? []),
            ...delegatedInvocations.visibleTools,
          ]),
        ],
      }
    : attemptToolSummary;
```

(`mergedAttemptToolSummary` replaces `attemptToolSummary` at its 4 existing
consumption sites, `run.ts:3816/4059/4150/4289` — a rename, not new call
sites.) `collectDelegatedToolInvocationsFromInternalEvents` is a new,
small, pure function (same shape/spirit as the existing
`collectPendingMediaFromInternalEvents` in `embedded-agent-subscribe.ts:135`,
a direct precedent for "extract a specific structured payload out of
`internalEvents`"): it filters `internalEvents` for `type === "task_completion"`
entries, flattens their `childToolEvidence` arrays, and returns each
invocation pre-tagged `viaSubagent: true`.

That tagging requires adding `viaSubagent?: boolean` to **three** places in
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
No merge target exists for `evidence` itself (see 3.3) — it's correctly
recomputed by the existing, unmodified `evidence: toolInvocations.map(...)`
line once `toolInvocations` carries the merged set.

**This merge only ever adds entries when `params.internalEvents` contains at
least one `task_completion` event with non-empty `childToolEvidence` — which
only happens for an attempt that resumed after consuming a subagent
completion.** An ordinary, non-delegating turn's `internalEvents` is
`undefined`/empty, `delegatedInvocations.invocations` is `[]`, and
`mergedAttemptToolSummary` is literally `=== attemptToolSummary` (same
reference, no new object even allocated) — `buildAgentDecisionTrace`'s
inputs are byte-for-byte identical to today for the overwhelming majority of
turns. This is the concrete mechanism behind the "no regressions for the
common case" goal — not a promise to be careful, but a structural
consequence of where the merge is gated.

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

| File                                                                             | Change                                                                                                                                                                                                                                                                                                                                                                                                                                |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/agents/subagent-registry.ts`                                                | Add `recordSubagentReplyAuditTrace(childSessionKey, auditTrace)` (3.1) — new, small, alongside `addSubagentRunForTests`/`releaseSubagentRun`. Looks up the live `subagentRuns` map directly (not the read-snapshot helper), sets `completion.resultAuditTrace`, persists.                                                                                                                                                             |
| `src/auto-reply/reply/agent-runner.ts`                                           | **Does need a change, unlike an earlier draft of this table claimed.** Capture the already-built `auditTrace` in a local variable instead of inlining it, and — inside the existing `if (!isHeartbeat)` block, right after `attachAgentDecisionTrace` — conditionally call `recordSubagentReplyAuditTrace` when `isSubagentSessionKey(sessionKey)`. New import of the subagent registry into this file; confirmed no circular import. |
| `src/agents/subagent-registry.types.ts`                                          | Add `resultAuditTrace?` to `SubagentCompletionState`; add `frozenAuditTrace?` to `PendingFinalDeliveryPayload`.                                                                                                                                                                                                                                                                                                                       |
| `src/agents/subagent-registry-lifecycle.ts`                                      | **No change to `freezeRunResultAtCompletion`/`refreshFrozenResultFromSession`** — the trace is already on the row by the time either runs. Only the two `PendingFinalDeliveryPayload`-building sites (`loadPendingFinalDeliveryPayload`, `refreshPendingFinalDeliveryPayload`) gain a `frozenAuditTrace` line mirroring the existing `frozenResultText` one.                                                                          |
| `src/agents/internal-events.ts`                                                  | Add `SubagentToolEvidence` type; add optional `childToolEvidence?` to `AgentTaskCompletionInternalEvent`. No change to prompt rendering.                                                                                                                                                                                                                                                                                              |
| `src/agents/subagent-announce.ts`                                                | Populate `childToolEvidence` when building `completionEvent`, for both the single-child and multi-child-findings paths, both reading `completion.resultAuditTrace` off the registry row (3.3) — no re-export needed here, `readSubagentOutput`/`captureSubagentCompletionReply` are untouched by this fix.                                                                                                                            |
| `src/agents/subagent-announce-output.ts` (`buildChildCompletionFindings` family) | Thread `frozenAuditTrace` through the same row shape already carrying `frozenResultText`, collect into the evidence array. **This is the only touch to this file** — no `readSubagentOutputWithTrace`/`captureSubagentCompletionReplyWithTrace` siblings; those are no longer needed.                                                                                                                                                 |
| `src/agents/embedded-agent-runner/run.ts`                                        | Add `collectDelegatedToolInvocationsFromInternalEvents` (new, pure, mirrors the existing `collectPendingMediaFromInternalEvents` pattern); merge its output into `attemptToolSummary` right after `buildTraceToolSummary` returns (~line 3739), tagging entries `viaSubagent: true`. No new fields on `runResult.meta`.                                                                                                               |
| `src/auto-reply/reply/agent-decision-trace.ts`                                   | Add optional `viaSubagent?: boolean` to the `ToolSummary.invocations` item type and to the two output object-literal constructions (`toolInvocations`, `evidence`) — additive, no logic change.                                                                                                                                                                                                                                       |

## 5. Testing

- Unit: `recordSubagentReplyAuditTrace` — given a childSessionKey matching a
  live registry row, sets `completion.resultAuditTrace` and persists; given
  no matching row (already cleaned up, or a plain top-level session that
  isn't a subagent at all), no-ops without throwing.
- Unit: `isSubagentSessionKey` gating in `agent-runner.ts` — a top-level
  session's reply never calls `recordSubagentReplyAuditTrace`; a subagent
  child's reply does, with the same `auditTrace` object that got attached
  to its own delivered payload.
- Unit: `collectDelegatedToolInvocationsFromInternalEvents` — given
  `internalEvents` with a `task_completion` entry carrying `childToolEvidence`,
  returns those invocations tagged `viaSubagent: true`; given `undefined`/`[]`/
  events with no `childToolEvidence`, returns `{invocations: [], visibleTools: []}`.
- Unit: the `run.ts` merge — given an attempt with N direct tool calls and
  `params.internalEvents` carrying M delegated ones, `mergedAttemptToolSummary.invocations`
  has N+M entries, the M delegated ones tagged `viaSubagent: true`; feeding
  that into the existing, unmodified `buildAgentDecisionTrace` shows
  disposition math (`successfulCalls`/`failedCalls`/etc.) counts them the
  same as direct invocations.
- Unit: merge is a no-op when `params.internalEvents` is absent or has no
  `task_completion` entries — `mergedAttemptToolSummary` is reference-equal
  to `attemptToolSummary` (no new object allocated), so
  `buildAgentDecisionTrace`'s output for a representative existing
  non-delegating test case is byte-identical to current behavior.
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
  that raw, internal array (shaped `{toolName, errored, status, ...}`, distinct
  from the public `{name, status, detail?}` trace shape) is accumulated and
  likely read by more than trace-building across a ~4,000-line function, so
  mutating it is higher blast radius than necessary. The chosen approach
  (3.4) mutates neither `attempt.toolMetas` nor `state.toolMetas` — it builds
  a merged copy of `attemptToolSummary`, the small, already-public-shaped,
  single-purpose object `buildTraceToolSummary` returns purely for trace
  consumption, immediately after that function returns. Narrower surface,
  same file, different (safer) variable.
- **Trace-build-time blind registry lookup, on the _parent_ side** ("which
  children did this session recently spawn") — rejected in favor of
  explicit tagging: blind lookup risks matching the wrong turn's children
  in a session with rapid successive delegations; the existing
  `inputProvenance`/`internalEvents` threading already identifies exactly
  which completion(s) this specific resume is for, so use that instead of
  inferring it. **Not the same thing as 3.1's registry lookup on the
  _child_ side** — that one is never blind: it's keyed by the exact
  `childSessionKey` the write is for, at the exact moment that child
  computes its own reply, with no ambiguity about which turn it belongs to.
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
