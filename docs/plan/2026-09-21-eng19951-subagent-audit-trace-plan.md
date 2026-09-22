# ENG-19951: Subagent Audit-Trace Evidence Implementation Plan

> **Status: implemented.** Every task below is complete and shipped on
> `fix/eng-19951-subagent-audit-trace`. This plan is retained as the historical
> record of how the fix was built (including two redesigns caught mid-execution
> — see the superseded-design notes on Tasks 3/5/6) and the reasoning behind
> each decision, not as work still to be executed. A handful of task steps
> below describe implementation details (a specific line/count/literal) that
> drifted once later tasks refactored the code they describe; each such spot
> is called out inline rather than silently left to mislead a reader diffing
> this plan against the shipped code.
>
> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a parent agent's delivered reply carry a completing subagent's tool-call evidence in its own `audit_trace`, so eval judges (and anything else reading the trace) see proof of delegated work instead of an empty trace for a turn that genuinely used tools via a spawned subagent.

**Architecture:** Capture the subagent's already-computed `AgentDecisionTrace` at the same point its final text is read (no second transcript scan), freeze it onto the subagent's registry row alongside the existing frozen text, carry it as a new optional field on the `task_completion` internal event (never rendered into the LLM prompt), and merge it into the parent's own tool-summary at the exact point in `run.ts` where that summary is already computed — using `internalEvents`, which is already available in that scope. Every new field is optional and every new code path is additive; the merge is a no-op whenever `internalEvents` carries no subagent completion, which is true for the overwhelming majority of turns.

**Tech Stack:** TypeScript, vitest (`npx vitest run <file>`), pnpm workspace.

**Spec:** `docs/specs/2026-09-18-eng19951-subagent-audit-trace-design.md` — read this first. It has the full root-cause analysis and the reasoning behind every decision below; this plan only breaks the approved design into ordered, testable steps.

## Global Constraints

- Every new field is `optional` (`?`). No existing field's meaning changes.
- No existing exported function's signature or behavior changes. New capability is added via sibling functions, never by editing an existing function's contract.
- The merge in `run.ts` must be provably a no-op (same object reference, not just "empty array") when there's no subagent evidence to merge, so a non-delegating turn's trace-building is untouched.
- All new code follows existing patterns in the touched files: `vitest` (`describe`/`it`/`expect`), the project's existing null/undefined-coalescing style (`??`), and TSDoc comments only where the WHY isn't obvious from the code.
- Every task's test command: `npx vitest run <path>` from the repo root.

---

## Task 1: `viaSubagent` tagging in `agent-decision-trace.ts`

**Files:**

- Modify: `src/auto-reply/reply/agent-decision-trace.ts:7-24` (the `ToolSummary` type), `:212-226` (`toolInvocations`/`evidence` construction inside `buildAgentDecisionTrace`)
- Test: `src/auto-reply/reply/agent-decision-trace.test.ts`

**Interfaces:**

- Produces: `ToolSummary["invocations"][number]` gains optional `viaSubagent?: boolean`. `AgentDecisionTrace["toolInvocations"][number]` and `AgentDecisionTrace["evidence"][number]` both carry `viaSubagent` through to output when set on input. This is the type every later task that tags a merged entry relies on.

This is purely additive — no existing test in `agent-decision-trace.test.ts` passes a `viaSubagent` field today, so none of them observe a behavior change. The new tests below are the only place this field is exercised until Task 7 wires a real producer.

- [ ] **Step 1: Write the failing test**

Add to `src/auto-reply/reply/agent-decision-trace.test.ts`, inside the existing `describe("buildAgentDecisionTrace", ...)` block:

```ts
it("carries viaSubagent through to both toolInvocations and evidence when set on input", () => {
  const trace = buildAgentDecisionTrace({
    toolSummary: {
      calls: 1,
      tools: ["takeoff_dispatch"],
      failures: 0,
      visibleTools: ["takeoff_dispatch"],
      invocations: [{ name: "takeoff_dispatch", status: "ok", viaSubagent: true }],
    },
  });
  expect(trace.toolInvocations).toEqual([
    { name: "takeoff_dispatch", status: "ok", viaSubagent: true },
  ]);
  expect(trace.evidence).toEqual([
    { kind: "tool_outcome", tool: "takeoff_dispatch", status: "ok", viaSubagent: true },
  ]);
});

it("omits viaSubagent from both outputs when not set on input", () => {
  const trace = buildAgentDecisionTrace({
    toolSummary: {
      calls: 1,
      tools: ["read"],
      failures: 0,
      visibleTools: ["read"],
      invocations: [{ name: "read", status: "ok" }],
    },
  });
  expect(trace.toolInvocations).toEqual([{ name: "read", status: "ok" }]);
  expect(trace.evidence).toEqual([{ kind: "tool_outcome", tool: "read", status: "ok" }]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/auto-reply/reply/agent-decision-trace.test.ts`
Expected: FAIL — the first new test fails because `viaSubagent` is silently dropped from both `toolInvocations` and `evidence` (TypeScript won't even accept `viaSubagent` on the input object literal yet, since `ToolSummary["invocations"]` doesn't declare it — expect a type error surfaced as a test/build failure).

- [ ] **Step 3: Add `viaSubagent` to the `ToolSummary` type**

In `src/auto-reply/reply/agent-decision-trace.ts`, change lines 12-16 (inside the `ToolSummary` type's `invocations` field):

```ts
  invocations?: Array<{
    name: string;
    status: "ok" | "partial" | "error" | "blocked";
    detail?: string;
    /**
     * Set when this invocation's evidence came from a subagent the current
     * turn delegated to, not from a tool the current attempt ran directly.
     * Additive — absent for every direct invocation, as today.
     */
    viaSubagent?: boolean;
  }>;
```

- [ ] **Step 4: Carry `viaSubagent` through the normalization step**

In `buildAgentDecisionTrace`, the `allInvocations` construction (around line 118-133) currently returns `[{ name, status, ...(detail ? { detail } : {}) }]`. Change it to also carry `viaSubagent` through:

```ts
return [
  {
    name,
    status,
    ...(detail ? { detail } : {}),
    ...(invocation.viaSubagent ? { viaSubagent: true } : {}),
  },
];
```

- [ ] **Step 5: Carry `viaSubagent` into the `evidence` construction**

The `evidence` array (around line 216-226) currently builds `{ kind: "tool_outcome", tool: invocation.name, status: invocation.status }` plus optional `detail`. Add `viaSubagent` the same way:

```ts
    evidence: toolInvocations.map((invocation) => {
      const entry: AgentDecisionTrace["evidence"][number] = {
        kind: "tool_outcome",
        tool: invocation.name,
        status: invocation.status,
      };
      if ("detail" in invocation && invocation.detail) {
        entry.detail = invocation.detail;
      }
      if ("viaSubagent" in invocation && invocation.viaSubagent) {
        entry.viaSubagent = true;
      }
      return entry;
    }),
```

Also add `viaSubagent?: boolean` to the `AgentDecisionTrace["evidence"][number]` and `AgentDecisionTrace["toolInvocations"][number]` type declarations near the top of the file (wherever `AgentDecisionTrace` itself is typed/imported from — if it's imported from another file, e.g. `reply-payload.js`, add it there instead; check the import at the top of `agent-decision-trace.ts` for `AgentDecisionTrace`'s source before editing).

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run src/auto-reply/reply/agent-decision-trace.test.ts`
Expected: PASS — all tests including the two new ones, and all pre-existing tests in this file unchanged (confirms zero regression for entries without `viaSubagent`).

- [ ] **Step 7: Commit**

```bash
git add src/auto-reply/reply/agent-decision-trace.ts src/auto-reply/reply/agent-decision-trace.test.ts
git commit -m "feat(trace): carry viaSubagent tag through tool-invocation trace building"
```

---

## Task 2: `SubagentToolEvidence` type and `childToolEvidence` field on the completion event

**Files:**

- Modify: `src/agents/internal-events.ts:1-42` (imports and `AgentTaskCompletionInternalEvent`)
- Test: `src/agents/internal-events.test.ts` (new file — none exists today)

**Interfaces:**

- Consumes: `AgentDecisionTrace["toolInvocations"]` type from Task 1 (via whatever module `agent-decision-trace.ts` imports `AgentDecisionTrace` from — reuse that same import path here, don't re-derive the type).
- Produces: `SubagentToolEvidence` type (`{ childSessionKey: string; toolInvocations: AgentDecisionTrace["toolInvocations"]; visibleTools: string[] }`), and `AgentTaskCompletionInternalEvent["childToolEvidence"]?: SubagentToolEvidence[]`. Task 6 populates this field; Task 7 reads it.

This task only adds a field to a type and confirms rendering is unaffected — there's no runtime logic to add yet (no producer exists until Task 6, no consumer until Task 7), so the test is a rendering-safety check: the new field must never leak into the LLM-facing prompt text.

- [ ] **Step 1: Write the failing test**

Create `src/agents/internal-events.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  formatAgentInternalEventsForPrompt,
  formatAgentInternalEventsForPlainPrompt,
} from "./internal-events.js";

describe("formatAgentInternalEventsForPrompt", () => {
  it("never renders childToolEvidence into the prompt text", () => {
    const rendered = formatAgentInternalEventsForPrompt([
      {
        type: "task_completion",
        source: "subagent",
        childSessionKey: "agent:main:subagent:abc",
        childSessionId: "sess-1",
        announceType: "subagent task",
        taskLabel: "run takeoff scopes",
        status: "ok",
        statusLabel: "completed; ready for parent review",
        result: "All 7 scopes completed.",
        replyInstruction: "Review/verify the result above...",
        childToolEvidence: [
          {
            childSessionKey: "agent:main:subagent:abc",
            toolInvocations: [{ name: "takeoff_dispatch", status: "ok" }],
            visibleTools: ["takeoff_dispatch"],
          },
        ],
      },
    ]);
    expect(rendered).toContain("All 7 scopes completed.");
    expect(rendered).not.toContain("takeoff_dispatch");
    expect(rendered).not.toContain("childToolEvidence");
  });
});

describe("formatAgentInternalEventsForPlainPrompt", () => {
  it("never renders childToolEvidence into the prompt text", () => {
    const rendered = formatAgentInternalEventsForPlainPrompt([
      {
        type: "task_completion",
        source: "subagent",
        childSessionKey: "agent:main:subagent:abc",
        childSessionId: "sess-1",
        announceType: "subagent task",
        taskLabel: "run takeoff scopes",
        status: "ok",
        statusLabel: "completed; ready for parent review",
        result: "All 7 scopes completed.",
        replyInstruction: "Review/verify the result above...",
        childToolEvidence: [
          {
            childSessionKey: "agent:main:subagent:abc",
            toolInvocations: [{ name: "takeoff_dispatch", status: "ok" }],
            visibleTools: ["takeoff_dispatch"],
          },
        ],
      },
    ]);
    expect(rendered).not.toContain("takeoff_dispatch");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/agents/internal-events.test.ts`
Expected: FAIL with a TypeScript error — `childToolEvidence` doesn't exist on the `AgentTaskCompletionInternalEvent` object literal type yet.

- [ ] **Step 3: Add the type and field**

In `src/agents/internal-events.ts`, find the import of `AgentDecisionTrace` used elsewhere in this codebase (check `src/auto-reply/reply/agent-decision-trace.ts`'s own export, or wherever `agent-decision-trace.ts` itself imports the base `AgentDecisionTrace` type from — likely `../auto-reply/reply-payload.js` based on other files in this plan). Add that same import to `internal-events.ts`, then add:

```ts
export type SubagentToolEvidence = {
  childSessionKey: string;
  toolInvocations: AgentDecisionTrace["toolInvocations"];
  visibleTools: string[];
};
```

Then extend `AgentTaskCompletionInternalEvent` (currently lines 23-37):

```ts
type AgentTaskCompletionInternalEvent = {
  type: typeof AGENT_INTERNAL_EVENT_TYPE_TASK_COMPLETION;
  source: AgentInternalEventSource;
  childSessionKey: string;
  childSessionId?: string;
  announceType: string;
  taskLabel: string;
  status: AgentInternalEventStatus;
  statusLabel: string;
  result: string;
  attachments?: AgentGeneratedAttachment[];
  mediaUrls?: string[];
  statsLine?: string;
  replyInstruction: string;
  /**
   * Structured tool-call evidence carried alongside the completion, one
   * entry per settled child in this wake. Never rendered into the prompt —
   * formatTaskCompletionEvent below only ever reads the prose fields above.
   * Consumed downstream (run.ts) to merge into the parent's own audit trace.
   */
  childToolEvidence?: SubagentToolEvidence[];
};
```

`formatTaskCompletionEvent` (the function that builds the prompt text) is not modified — it never references `childToolEvidence`, which is the entire point of this test.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/agents/internal-events.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/agents/internal-events.ts src/agents/internal-events.test.ts
git commit -m "feat(subagent): add SubagentToolEvidence type to task_completion event"
```

---

## Task 3: record a subagent's own audit trace directly onto its registry row

**Superseded design note:** the first version of this task tried to read
`auditTrace` back off the child's session transcript. That's impossible —
`auditTrace` is computed in `agent-runner.ts` right before a reply is
delivered; the transcript entry for the same turn is written earlier,
inside the embedded-agent-runner, before `agent-runner.ts` even starts its
post-processing. Confirmed by grepping `agent-runner.ts` for any
transcript-write call: zero. Found this only by actually running Task 3 —
see the spec's 3.1 for the full trace. This version writes the trace
directly instead.

**Files:**

- Modify: `src/agents/subagent-registry.ts` (add `recordSubagentReplyAuditTrace`, near `addSubagentRunForTests`/`releaseSubagentRun` at line ~1311; add an `AgentDecisionTrace` type import)
- Modify: `src/auto-reply/reply/agent-runner.ts` (~line 2418-2432: capture the built trace in a local variable, call the new function conditionally; add imports for `isSubagentSessionKey` and `recordSubagentReplyAuditTrace`)
- Test: `src/agents/subagent-registry.test.ts` (or wherever this file's existing tests for other simple registry mutators live — check before assuming; if none fit, create `src/agents/subagent-registry.record-reply-audit-trace.test.ts` following this family's convention of small, focused test files per concern)
- Test: `src/auto-reply/reply/agent-runner.test.ts` (or its closest equivalent — check for an existing test asserting on `attachAgentDecisionTrace`'s call site and extend it, rather than inventing new scaffolding)

**Interfaces:**

- Produces: `recordSubagentReplyAuditTrace(childSessionKey: string, auditTrace: AgentDecisionTrace): void`, exported from `subagent-registry.ts`. Task 5 (indirectly, via `PendingFinalDeliveryPayload`) and Task 6 (via `getLatestSubagentRunByChildSessionKey`) read `completion.resultAuditTrace` that this function sets.
- Consumes: nothing new — `isSubagentSessionKey` (`src/sessions/session-key-utils.ts:270`) and `subagentRuns` (the live map, imported into `subagent-registry.ts` from `subagent-registry-memory.ts` — already imported there) both already exist.
- Guarantee: for a non-subagent (top-level) session, `isSubagentSessionKey(sessionKey)` is `false` and `recordSubagentReplyAuditTrace` is never called — zero behavior change for the overwhelmingly common case, structurally (not just by convention).

- [ ] **Step 1: Write the failing test for `recordSubagentReplyAuditTrace`**

First read `src/agents/subagent-registry.ts` lines 1-60 (imports), ~1240-1320 (`addSubagentRunForTests`, `releaseSubagentRun`, and neighbors), and ~1520-1550 (`getLatestSubagentRunByChildSessionKey`, for the lookup-loop shape to mirror) — these exact line ranges are from this session's own research; re-confirm before writing code, this file is large and any commit history since could have shifted them slightly. Also check whichever test file you're extending for its existing setup pattern (how does it construct a `SubagentRunRecord` fixture and insert it into the registry for a test — likely via `addSubagentRunForTests` or a similar test helper already used elsewhere in that file).

```ts
it("records the audit trace onto the matching registry row and persists", () => {
  const entry: SubagentRunRecord = {
    runId: "run-1",
    childSessionKey: "agent:main:subagent:child-1",
    requesterSessionKey: "agent:main:main",
    requesterDisplayKey: "main",
    task: "run takeoff scopes",
    cleanup: "keep",
    createdAt: 1_000,
  };
  addSubagentRunForTests(entry);

  const auditTrace: AgentDecisionTrace = {
    schemaVersion: 1,
    visibleTools: ["takeoff_dispatch"],
    toolInvocations: [{ name: "takeoff_dispatch", status: "ok" }],
    evidence: [{ kind: "tool_outcome", tool: "takeoff_dispatch", status: "ok" }],
    confidence: "high",
    disposition: "completed",
    reason: "tool_execution_succeeded",
  };
  recordSubagentReplyAuditTrace("agent:main:subagent:child-1", auditTrace);

  const found = getLatestSubagentRunByChildSessionKey("agent:main:subagent:child-1");
  expect(found?.completion?.resultAuditTrace).toEqual(auditTrace);
});

it("no-ops without throwing when no registry row matches the session key", () => {
  expect(() =>
    recordSubagentReplyAuditTrace("agent:main:subagent:does-not-exist", {
      schemaVersion: 1,
      visibleTools: [],
      toolInvocations: [],
      evidence: [],
      confidence: "medium",
      disposition: "completed",
      reason: "no_tools_visible",
    }),
  ).not.toThrow();
});
```

(Check whether this test file needs `resetSubagentRegistryForTests()` in a `beforeEach`/`afterEach` to isolate `addSubagentRunForTests`'s effect on the shared module-level `subagentRuns` map from other tests in the same file — most likely yes, following whatever pattern the file's existing tests already use for this.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run <the test file from Step 1>`
Expected: FAIL — `recordSubagentReplyAuditTrace` is not exported yet.

- [ ] **Step 3: Implement `recordSubagentReplyAuditTrace`**

In `src/agents/subagent-registry.ts`, add near the top: `import type { AgentDecisionTrace } from "../auto-reply/reply-payload.js";` (confirm this exact relative path from this file's location before using it — it's `../auto-reply/reply-payload.js` from `src/agents/`, matching Task 1's import in `internal-events.ts` which sits at the same depth).

Add the function near `addSubagentRunForTests`/`releaseSubagentRun` (~line 1311):

```ts
/**
 * Records a subagent's own already-computed audit trace onto its registry
 * row (ENG-19951). Called from agent-runner.ts at the exact point that
 * trace is computed for the child's own reply — independent of, and
 * earlier than, the later text-only completion freeze. Looks up the live
 * map directly, not via getSubagentRunsSnapshotForRead (which may return a
 * structuredClone'd snapshot outside test mode, so writing through it
 * would silently not persist). No-ops if no row matches — an orphaned or
 * already-cleaned-up child simply has nothing left to record onto.
 */
export function recordSubagentReplyAuditTrace(
  childSessionKey: string,
  auditTrace: AgentDecisionTrace,
): void {
  const key = childSessionKey.trim();
  if (!key) {
    return;
  }
  let latest: SubagentRunRecord | null = null;
  for (const entry of subagentRuns.values()) {
    if (entry.childSessionKey !== key) {
      continue;
    }
    if (!latest || entry.createdAt > latest.createdAt) {
      latest = entry;
    }
  }
  if (!latest) {
    return;
  }
  ensureCompletionState(latest).resultAuditTrace = auditTrace;
  persistSubagentRuns();
}
```

(Note: the shipped implementation uses the existing `ensureCompletionState` helper from
`subagent-delivery-state.js`, not a hand-rolled `{ ...(latest.completion ?? { required: false }) }`
spread — the latter would mislabel a run with `expectsCompletionMessage: true` as
`required: false` the first time its completion state is created, since
`ensureCompletionState` derives `required` from `expectsCompletionMessage`, not a
hardcoded default.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run <the test file from Step 1>`
Expected: PASS.

- [ ] **Step 5: Write the failing test for the `agent-runner.ts` call site**

Find (or, if none exists, add near) an existing test in `agent-runner.ts`'s test suite that already asserts on `attachAgentDecisionTrace`'s output for a delivered reply — extend it, don't build new scaffolding. Add a case for a subagent child session:

```ts
it("records the audit trace onto the subagent registry when the reply is for a subagent child session", async () => {
  // ... reuse this suite's existing harness to run a reply for
  // sessionKey "agent:main:subagent:child-1" with some toolSummary ...
  // assert recordSubagentReplyAuditTrace (mocked) was called once with
  // ("agent:main:subagent:child-1", the same auditTrace object attached
  // to the delivered payload).
});

it("does not record onto the registry for a top-level (non-subagent) session", async () => {
  // ... same harness, sessionKey "agent:main:main" ...
  // assert recordSubagentReplyAuditTrace (mocked) was NOT called.
});
```

(This step's exact mock setup depends on how `agent-runner.ts`'s existing test suite mocks its many dependencies — read that suite's top-level `vi.mock` calls first, find its existing pattern for mocking a same-layer sibling function call, and mirror it. Do not guess a mock shape that doesn't match the file's real conventions — this is the same discipline that caught real problems in Tasks 5/6 during the first draft of this plan.)

- [ ] **Step 6: Run test to verify it fails**

Run: `npx vitest run <agent-runner.ts's test file>`
Expected: FAIL — the call site doesn't exist yet.

- [ ] **Step 7: Wire the call site**

In `src/auto-reply/reply/agent-runner.ts`, add imports:

```ts
import { isSubagentSessionKey } from "../../sessions/session-key-utils.js";
import { recordSubagentReplyAuditTrace } from "../../agents/subagent-registry.js";
```

(Confirm these exact relative paths from `src/auto-reply/reply/agent-runner.ts`'s location before using them.)

Change the `if (!isHeartbeat) { ... }` block (~line 2419-2432):

```ts
if (!isHeartbeat) {
  // Attach before verbose, raw-trace, and usage decorations so audit facts
  // stay on the terminal assistant reply instead of diagnostic payloads.
  const auditTrace = buildAgentDecisionTrace({
    toolSummary,
    completion,
    error: runResult.meta?.error,
    failureSignal: runResult.meta?.failureSignal,
    payloads: finalPayloads,
  });
  finalPayloads = attachAgentDecisionTrace(finalPayloads, auditTrace);
  // ENG-19951: a subagent's own reply computes its audit trace here, same
  // as any top-level reply (this is the same call, not a special path) —
  // record it directly on the registry row so the parent's eventual
  // announce can merge it in later. No-op for a non-subagent session.
  if (isSubagentSessionKey(sessionKey)) {
    recordSubagentReplyAuditTrace(sessionKey, auditTrace);
  }
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npx vitest run <agent-runner.ts's test file>`
Expected: PASS — both new tests, and every pre-existing test in the suite (confirms zero behavior change to the delivered payload itself — only a new, side-effecting call for subagent sessions).

- [ ] **Step 9: Commit**

```bash
git add src/agents/subagent-registry.ts src/auto-reply/reply/agent-runner.ts
git commit -m "feat(subagent): record a subagent's own audit trace onto its registry row"
```

(Include whichever test file(s) Steps 1 and 5 actually created/modified — the exact filenames depend on what you found this repo's existing convention to be.)

---

## Task 4: registry types carry the frozen trace

**Files:**

- Modify: `src/agents/subagent-registry.types.ts:11-45` (`PendingFinalDeliveryPayload`, `SubagentCompletionState`)
- Test: `src/agents/subagent-registry.types.test.ts` (new file)

**Interfaces:**

- Produces: `SubagentCompletionState.resultAuditTrace?: AgentDecisionTrace`, `PendingFinalDeliveryPayload.frozenAuditTrace?: AgentDecisionTrace`. Task 5 writes both; Task 6 reads both.

This is a type-only change with no runtime logic — the "test" is a compile-time assignability check, which vitest still runs as a real test file so it's caught in CI the same way as everything else, not just by an editor.

- [ ] **Step 1: Write the failing test**

Create `src/agents/subagent-registry.types.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type {
  PendingFinalDeliveryPayload,
  SubagentCompletionState,
} from "./subagent-registry.types.js";

describe("subagent registry types carry the frozen audit trace", () => {
  it("SubagentCompletionState accepts resultAuditTrace", () => {
    const completion: SubagentCompletionState = {
      required: true,
      resultText: "done",
      resultAuditTrace: {
        schemaVersion: 1,
        visibleTools: [],
        toolInvocations: [],
        evidence: [],
        confidence: "medium",
        disposition: "completed",
        reason: "no_tools_visible",
      },
    };
    expect(completion.resultAuditTrace?.disposition).toBe("completed");
  });

  it("PendingFinalDeliveryPayload accepts frozenAuditTrace", () => {
    const payload: PendingFinalDeliveryPayload = {
      requesterSessionKey: "s1",
      requesterDisplayKey: "s1",
      childSessionKey: "s2",
      childRunId: "r1",
      task: "run takeoff",
      frozenAuditTrace: {
        schemaVersion: 1,
        visibleTools: [],
        toolInvocations: [],
        evidence: [],
        confidence: "medium",
        disposition: "completed",
        reason: "no_tools_visible",
      },
    };
    expect(payload.frozenAuditTrace?.reason).toBe("no_tools_visible");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/agents/subagent-registry.types.test.ts`
Expected: FAIL — TypeScript error, `resultAuditTrace`/`frozenAuditTrace` don't exist on these types yet.

- [ ] **Step 3: Add the fields**

In `src/agents/subagent-registry.types.ts`, import `AgentDecisionTrace` (same source as prior tasks). Add to `PendingFinalDeliveryPayload` (after line 25, `fallbackFrozenResultText?: string | null;`):

```ts
  frozenAuditTrace?: AgentDecisionTrace;
```

Add to `SubagentCompletionState` (after line 41, `resultText?: string | null;`):

```ts
  resultAuditTrace?: AgentDecisionTrace;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/agents/subagent-registry.types.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/agents/subagent-registry.types.ts src/agents/subagent-registry.types.test.ts
git commit -m "feat(subagent): add resultAuditTrace/frozenAuditTrace to registry types"
```

---

## Task 5: forward the recorded trace through `PendingFinalDeliveryPayload`

**Superseded design note:** the first version of this task added an
optional `captureSubagentCompletionReplyWithTrace` dependency and had
`freezeRunResultAtCompletion` capture the trace at freeze time. That's no
longer needed — Task 3's direct write means `completion.resultAuditTrace`
is already set (if the child ever replied at all) by the time freeze runs.
Freeze needs **zero changes**. This task is now much smaller: just forward
the already-set field through the one place that still needs it,
`PendingFinalDeliveryPayload`.

**Files:**

- Modify: `src/agents/subagent-registry-lifecycle.ts:527-552` (`loadPendingFinalDeliveryPayload`), `:567-585` (`refreshPendingFinalDeliveryPayload`)
- Test: `src/agents/subagent-registry-lifecycle.test.ts`

**Interfaces:**

- Consumes: `resultAuditTrace`/`frozenAuditTrace` fields from Task 4; `completion.resultAuditTrace` as set by Task 3's `recordSubagentReplyAuditTrace` (this task does not set it — only reads and forwards it).
- Produces: `PendingFinalDeliveryPayload.frozenAuditTrace` mirrors `frozenResultText`'s existing precedence at both call sites.
- Guarantee: `freezeRunResultAtCompletion`/`refreshFrozenResultFromSession` are byte-identical to before this task — verified by the full existing test suite in this file passing with zero new mocks needed for those two functions.

- [ ] **Step 1: Write the failing test**

Read `src/agents/subagent-registry-lifecycle.test.ts` lines 104-200 (`createRunEntry`, `createLifecycleController`) before writing this, and find whichever existing test already asserts on the shape of a built `PendingFinalDeliveryPayload` (search this file for `frozenResultText` in an `expect(...)` — there should be at least one, since that's the field this task's new one mirrors) — extend that test rather than inventing new scaffolding:

```ts
it("carries the registry-recorded audit trace through to the pending delivery payload", async () => {
  const entry = createRunEntry({
    expectsCompletionMessage: true,
  });
  // Simulate Task 3's direct write already having landed before this run
  // any pending-delivery-payload build — this task never sets
  // resultAuditTrace itself, only reads it.
  entry.completion = {
    required: true,
    resultText: "All 7 scopes completed.",
    resultAuditTrace: {
      schemaVersion: 1,
      visibleTools: ["takeoff_dispatch"],
      toolInvocations: [{ name: "takeoff_dispatch", status: "ok" }],
      evidence: [{ kind: "tool_outcome", tool: "takeoff_dispatch", status: "ok" }],
      confidence: "high",
      disposition: "completed",
      reason: "tool_execution_succeeded",
    },
  };

  // ... drive whichever existing lifecycle path builds and exposes
  // PendingFinalDeliveryPayload for this entry (the same path the
  // existing frozenResultText-asserting test already exercises) ...
  // expect(pendingPayload.frozenAuditTrace).toEqual(entry.completion.resultAuditTrace);
});
```

(The middle section is deliberately left as a description, not invented code — copy the exact drive-and-read pattern from the existing `frozenResultText` test you found, changing only the assertion. Writing fabricated plumbing here that doesn't match this file's real mechanism would be worse than no test at all.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/agents/subagent-registry-lifecycle.test.ts`
Expected: FAIL — `pendingPayload.frozenAuditTrace` is `undefined`.

- [ ] **Step 3: Update both `PendingFinalDeliveryPayload`-building sites**

In `loadPendingFinalDeliveryPayload` (lines 527-552), add after the existing `frozenResultText: entry.delivery?.payload?.frozenResultText ?? entry.completion?.resultText,` line:

```ts
      frozenAuditTrace: entry.delivery?.payload?.frozenAuditTrace ?? entry.completion?.resultAuditTrace,
```

In `refreshPendingFinalDeliveryPayload` (lines 567-585), add after the existing `frozenResultText: entry.completion?.resultText,` line:

```ts
      frozenAuditTrace: entry.completion?.resultAuditTrace,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/agents/subagent-registry-lifecycle.test.ts`
Expected: PASS — the new test, and every pre-existing test in this file unmodified (confirms `freezeRunResultAtCompletion`/`refreshFrozenResultFromSession` genuinely needed no changes).

- [ ] **Step 5: Commit**

```bash
git add src/agents/subagent-registry-lifecycle.ts src/agents/subagent-registry-lifecycle.test.ts
git commit -m "feat(subagent): forward the recorded audit trace through PendingFinalDeliveryPayload"
```

---

## Task 6: populate `childToolEvidence` on the completion event (single-child and multi-child)

**Superseded design note:** the first version of this task threaded a
`replyAuditTrace` through the two transcript-read call sites in
`runSubagentAnnounceFlow`, and — because of that — had to document a
deliberate gap for `params.roundOneReply`, a third source for `reply` that
bypasses those reads entirely. Task 3's redesign removes the gap along
with the complexity that caused it: `completion.resultAuditTrace` is now
set directly on the registry row whenever the child computes any reply at
all, so the single-child path here is a plain registry lookup by
`childSessionKey` — completely independent of which text-source `reply`
came from. `roundOneReply` is no longer relevant to this task.

**Files:**

- Modify: `src/agents/subagent-announce-output.ts:366-438` (`ChildCompletionRow` type, `selectChildCompletionResultText`, `buildChildCompletionFindings`)
- Modify: `src/agents/subagent-announce.ts:242-544` (`runSubagentAnnounceFlow` — the `completionEvent` construction, ~line 531 in the pre-plan version; verify the exact current line via the file's own content before editing, since Tasks 1-5 don't touch this file so line numbers here are stable from the spec's own citations)
- Test: `src/agents/subagent-announce.test.ts`, `src/agents/subagent-announce-output.test.ts`

**Interfaces:**

- Consumes: `SubagentToolEvidence` (Task 2), `resultAuditTrace`/`frozenAuditTrace` (Task 4), `subagentRegistryRuntime.getLatestSubagentRunByChildSessionKey` (already imported/used in this function today, per the existing call at the multi-child findings section — reused here for the single-child case too, not a new dependency).
- Produces: `completionEvent.childToolEvidence` populated for both the single-child direct path and the multi-child `buildChildCompletionFindings` wake path — this is what `run.ts` (Task 7) reads.

- [ ] **Step 1: Write the failing test — single child**

Read `src/agents/subagent-announce.test.ts` lines 1-240 (mock setup, `runCompletionFixture`, and the `subagentRegistryRuntimeMock` hoisted at line ~44) before writing this — `subagentRegistryRuntimeMock.getLatestSubagentRunByChildSessionKey` will need a `vi.fn()` added if it isn't already one of the mocked methods there (check the existing `subagentRegistryRuntimeMock` object's keys first; several sibling methods like `resolveRequesterForChildSession` are already present, so this is very likely a matter of adding one more key to that same object, not inventing new mock infrastructure).

Add the test, in `describe("subagent announce seam flow", ...)`:

```ts
it("populates childToolEvidence on the completion event from the registry-recorded audit trace", async () => {
  const auditTrace = {
    schemaVersion: 1,
    visibleTools: ["takeoff_dispatch"],
    toolInvocations: [{ name: "takeoff_dispatch", status: "ok" }],
    evidence: [{ kind: "tool_outcome", tool: "takeoff_dispatch", status: "ok" }],
    confidence: "high",
    disposition: "completed",
    reason: "tool_execution_succeeded",
  };
  subagentRegistryRuntimeMock.getLatestSubagentRunByChildSessionKey.mockReturnValueOnce({
    childSessionKey: "agent:main:subagent:fixture",
    completion: { required: true, resultAuditTrace: auditTrace },
  });

  await runCompletionFixture({ roundOneReply: "All 7 scopes completed." });

  const call = requireAgentCall();
  const message = (call.params as { message?: string })?.message ?? "";
  expect(message).toContain("All 7 scopes completed.");
  // completionEvent.childToolEvidence is carried on the internalEvents param,
  // not rendered into the message text (Task 2/3.3's guarantee) — assert on
  // the internalEvents param this test's agent mock actually receives.
  const internalEvents = (
    call.params as { internalEvents?: Array<{ childToolEvidence?: unknown }> }
  )?.internalEvents;
  expect(internalEvents?.[0]?.childToolEvidence).toEqual([
    {
      childSessionKey: "agent:main:subagent:fixture",
      toolInvocations: [{ name: "takeoff_dispatch", status: "ok" }],
      visibleTools: ["takeoff_dispatch"],
    },
  ]);
});
```

Note this test deliberately keeps `roundOneReply: "All 7 scopes completed."` (the fixture's default text-source) rather than forcing the flow through a transcript read — proving the point of this redesign: evidence population works **regardless** of which text-source supplied `reply`.

(This test asserts on `internalEvents` in the `agent` gateway call params, per `subagent-announce-delivery.ts`'s `directAgentParams.internalEvents: params.internalEvents` wiring already confirmed in the spec — check this test file's mocked `deliverSubagentAnnouncement`/`callGatewayMock` implementation, lines 93-196, to confirm exactly which mock's call arguments actually carry `internalEvents` through to `requireAgentCall()`; the mock at lines 135-154 builds its own `params` object for the `agent` gateway call and does not currently forward `internalEvents` — if it doesn't, add `internalEvents: params.internalEvents` to that mock's constructed `params` object as part of this step, since a test mock that silently drops a field the real code path carries would make this assertion meaningless.)

- [ ] **Step 2: Write the failing test — multi-child wake**

Add to `src/agents/subagent-announce-output.test.ts`, extending the existing `buildChildCompletionFindings` test suite:

```ts
it("carries childToolEvidence for every child that has a frozen audit trace", () => {
  const rows = [
    {
      childSessionKey: "child-a",
      task: "run steel scope",
      createdAt: 1,
      outcome: { status: "ok" as const },
      completion: {
        resultText: "steel done",
        resultAuditTrace: {
          schemaVersion: 1 as const,
          visibleTools: ["takeoff_dispatch"],
          toolInvocations: [{ name: "takeoff_dispatch", status: "ok" as const }],
          evidence: [],
          confidence: "high" as const,
          disposition: "completed" as const,
          reason: "tool_execution_succeeded" as const,
        },
      },
    },
    {
      childSessionKey: "child-b",
      task: "run concrete scope",
      createdAt: 2,
      outcome: { status: "ok" as const },
      completion: { resultText: "concrete done" }, // no audit trace on this one
    },
  ];
  const evidence = collectChildCompletionToolEvidence(rows);
  expect(evidence).toEqual([
    {
      childSessionKey: "child-a",
      toolInvocations: [{ name: "takeoff_dispatch", status: "ok" }],
      visibleTools: ["takeoff_dispatch"],
    },
  ]);
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run src/agents/subagent-announce.test.ts src/agents/subagent-announce-output.test.ts`
Expected: FAIL — `collectChildCompletionToolEvidence` doesn't exist; `completionEvent.childToolEvidence` is `undefined`.

- [ ] **Step 4: Add `collectChildCompletionToolEvidence` and extend `ChildCompletionRow`**

In `src/agents/subagent-announce-output.ts`, extend `ChildCompletionRow` (lines 366-384) with the trace field, mirroring how `resultText` is already carried there:

```ts
type ChildCompletionRow = {
  childSessionKey: string;
  task: string;
  label?: string;
  createdAt: number;
  endedAt?: number;
  frozenResultText?: string | null;
  completion?: {
    resultText?: string | null;
    fallbackResultText?: string | null;
    resultAuditTrace?: AgentDecisionTrace;
  };
  delivery?: {
    payload?: {
      frozenResultText?: string | null;
      fallbackFrozenResultText?: string | null;
      frozenAuditTrace?: AgentDecisionTrace;
    };
  };
  outcome?: SubagentRunOutcome;
};
```

Add a matching selector next to `selectChildCompletionResultText` (line 386-395):

```ts
function selectChildCompletionAuditTrace(
  child: ChildCompletionRow,
): AgentDecisionTrace | undefined {
  return child.completion?.resultAuditTrace ?? child.delivery?.payload?.frozenAuditTrace;
}
```

Add the new export, using the same sort order `buildChildCompletionFindings` already applies (lines 400-407) so evidence order matches the prose findings order:

```ts
export function collectChildCompletionToolEvidence(
  children: Array<ChildCompletionRow>,
): SubagentToolEvidence[] {
  const sorted = [...children].toSorted((a, b) => {
    if (a.createdAt !== b.createdAt) {
      return a.createdAt - b.createdAt;
    }
    const aEnded = typeof a.endedAt === "number" ? a.endedAt : Number.MAX_SAFE_INTEGER;
    const bEnded = typeof b.endedAt === "number" ? b.endedAt : Number.MAX_SAFE_INTEGER;
    return aEnded - bEnded;
  });
  const out: SubagentToolEvidence[] = [];
  for (const child of sorted) {
    const auditTrace = selectChildCompletionAuditTrace(child);
    if (!auditTrace?.toolInvocations?.length) {
      continue;
    }
    out.push({
      childSessionKey: child.childSessionKey,
      toolInvocations: auditTrace.toolInvocations,
      visibleTools: auditTrace.visibleTools ?? [],
    });
  }
  return out;
}
```

Import `SubagentToolEvidence` and `AgentDecisionTrace` at the top of this file (Task 2's export, and the same `AgentDecisionTrace` source used throughout).

- [ ] **Step 5: Populate `childToolEvidence` in `runSubagentAnnounceFlow`**

In `src/agents/subagent-announce.ts`, import `collectChildCompletionToolEvidence` and `SubagentToolEvidence` alongside the existing imports from `./subagent-announce-output.js` (line 38-48) and `./internal-events.js` (line 23-27).

Where `completionEvent: AgentInternalEvent` is constructed (spec cites ~line 531; re-verify the exact current line in this file before editing, since it's unmodified by prior tasks), add `childToolEvidence`, sourced from a **plain registry lookup by this child's own session key** — no threading through `reply`'s text-source at all:

```ts
const ownAuditTrace = subagentRegistryRuntime?.getLatestSubagentRunByChildSessionKey?.(
  params.childSessionKey,
)?.completion?.resultAuditTrace;
const directChildToolEvidence: SubagentToolEvidence[] = childCompletionFindings
  ? [] // multi-child path fills this below, before completionEvent is built
  : ownAuditTrace?.toolInvocations?.length
    ? [
        {
          childSessionKey: params.childSessionKey,
          toolInvocations: ownAuditTrace.toolInvocations,
          visibleTools: ownAuditTrace.visibleTools ?? [],
        },
      ]
    : [];
const completionEvent: AgentInternalEvent = {
  type: "task_completion",
  source: announceType === "cron job" ? "cron" : "subagent",
  childSessionKey: params.childSessionKey,
  childSessionId: announceSessionId,
  announceType,
  taskLabel,
  status: outcome.status,
  statusLabel,
  result: findings,
  statsLine,
  replyInstruction,
  ...(directChildToolEvidence.length > 0 ? { childToolEvidence: directChildToolEvidence } : {}),
};
```

`subagentRegistryRuntime` is already loaded earlier in this function (the multi-child findings section above already calls
`subagentAnnounceDeps.loadSubagentRegistryRuntime()` and assigns it to a
`let subagentRegistryRuntime: ... | undefined;` that stays in scope for the
rest of the function) — confirm this before writing the code, since if the
lookup happens to run before that load in some code path, the optional
chaining above (`subagentRegistryRuntime?.`) degrades gracefully to no
evidence rather than throwing, matching the "can only add evidence, never
break existing behavior" guarantee elsewhere in this plan.

For the multi-child wake path (where `childCompletionFindings` is set from `buildChildCompletionFindings`, lines ~356-364 in the spec's citation), call `collectChildCompletionToolEvidence` on the exact same `directChildren` array (after the same `dedupeLatestChildCompletionRows(filterCurrentDirectChildCompletionRows(...))` filtering) and assign its result into `directChildToolEvidence` instead of the single-child branch above:

```ts
if (Array.isArray(directChildren) && directChildren.length > 0) {
  const filteredChildren = dedupeLatestChildCompletionRows(
    filterCurrentDirectChildCompletionRows(directChildren, {
      requesterSessionKey: params.childSessionKey,
      getLatestSubagentRunByChildSessionKey:
        subagentRegistryRuntime.getLatestSubagentRunByChildSessionKey,
    }),
  );
  childCompletionFindings = buildChildCompletionFindings(filteredChildren);
  multiChildToolEvidence = collectChildCompletionToolEvidence(filteredChildren);
}
```

(introducing `let multiChildToolEvidence: SubagentToolEvidence[] = [];` near `let childCompletionFindings`, and using it in place of the `directChildToolEvidence` ternary's multi-child branch above — i.e. `childCompletionFindings ? multiChildToolEvidence : [single-child branch]`).

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run src/agents/subagent-announce.test.ts src/agents/subagent-announce-output.test.ts`
Expected: PASS — new tests plus every pre-existing test in both files.

- [ ] **Step 7: Commit**

```bash
git add src/agents/subagent-announce.ts src/agents/subagent-announce-output.ts src/agents/subagent-announce.test.ts src/agents/subagent-announce-output.test.ts
git commit -m "feat(subagent): populate childToolEvidence for single- and multi-child completions"
```

---

## Task 7: merge delegated evidence into the parent's `attemptToolSummary`

**Files:**

- Modify: `src/agents/embedded-agent-runner/run.ts:3739` (right after `buildTraceToolSummary` is called) and its 4 consumption sites (`~3816/4059/4150/4289` per the spec — re-verify exact current line numbers before editing, since Tasks 1-6 don't touch this file)
- Test: `src/agents/embedded-agent-runner/run.trace-tool-summary.test.ts`

**Interfaces:**

- Consumes: `AgentTaskCompletionInternalEvent.childToolEvidence` (Task 2), `params.internalEvents` (already existed on `RunEmbeddedAgentParams`).
- Produces: `mergedAttemptToolSummary`, used at all 4 sites that previously used `attemptToolSummary` directly. **This is the task that makes the fix observable** — after this task, `agent-runner.ts` (unmodified) produces a non-empty `audit_trace` for a resumed parent turn.

- [ ] **Step 1: Write the failing test**

Add to `src/agents/embedded-agent-runner/run.trace-tool-summary.test.ts`. This file currently only imports `buildTraceToolSummary`; add `collectDelegatedToolInvocationsFromInternalEvents` to the import:

```ts
import { buildTraceToolSummary, collectDelegatedToolInvocationsFromInternalEvents } from "./run.js";

describe("collectDelegatedToolInvocationsFromInternalEvents", () => {
  it("returns empty when internalEvents is undefined", () => {
    expect(collectDelegatedToolInvocationsFromInternalEvents(undefined)).toEqual({
      invocations: [],
      visibleTools: [],
    });
  });

  it("returns empty when no event is a task_completion with childToolEvidence", () => {
    expect(
      collectDelegatedToolInvocationsFromInternalEvents([
        {
          type: "task_completion",
          source: "subagent",
          childSessionKey: "c1",
          announceType: "subagent task",
          taskLabel: "t",
          status: "ok",
          statusLabel: "completed",
          result: "done",
          replyInstruction: "review",
        },
      ]),
    ).toEqual({ invocations: [], visibleTools: [] });
  });

  it("flattens childToolEvidence across events and tags each invocation viaSubagent", () => {
    const result = collectDelegatedToolInvocationsFromInternalEvents([
      {
        type: "task_completion",
        source: "subagent",
        childSessionKey: "c1",
        announceType: "subagent task",
        taskLabel: "t",
        status: "ok",
        statusLabel: "completed",
        result: "done",
        replyInstruction: "review",
        childToolEvidence: [
          {
            childSessionKey: "c1",
            toolInvocations: [{ name: "takeoff_dispatch", status: "ok" }],
            visibleTools: ["takeoff_dispatch"],
          },
          {
            childSessionKey: "c2",
            toolInvocations: [{ name: "takeoff_status_poll", status: "ok" }],
            visibleTools: ["takeoff_status_poll"],
          },
        ],
      },
    ]);
    expect(result.invocations).toEqual([
      { name: "takeoff_dispatch", status: "ok", viaSubagent: true },
      { name: "takeoff_status_poll", status: "ok", viaSubagent: true },
    ]);
    expect(result.visibleTools.toSorted()).toEqual(["takeoff_dispatch", "takeoff_status_poll"]);
  });
});

describe("buildTraceToolSummary + delegated merge (integration shape)", () => {
  it("merging delegated invocations into an existing summary preserves direct invocations untagged", () => {
    const direct = buildTraceToolSummary({
      visibleToolNames: ["message"],
      toolMetas: [{ toolName: "message", errored: false }],
      hadFailure: false,
    });
    const delegated = collectDelegatedToolInvocationsFromInternalEvents([
      {
        type: "task_completion",
        source: "subagent",
        childSessionKey: "c1",
        announceType: "subagent task",
        taskLabel: "t",
        status: "ok",
        statusLabel: "completed",
        result: "done",
        replyInstruction: "review",
        childToolEvidence: [
          {
            childSessionKey: "c1",
            toolInvocations: [{ name: "takeoff_dispatch", status: "ok" }],
            visibleTools: ["takeoff_dispatch"],
          },
        ],
      },
    ]);
    const merged = {
      ...direct,
      invocations: [...(direct?.invocations ?? []), ...delegated.invocations],
      visibleTools: [...new Set([...(direct?.visibleTools ?? []), ...delegated.visibleTools])],
    };
    expect(merged.invocations).toEqual([
      { name: "message", status: "ok" },
      { name: "takeoff_dispatch", status: "ok", viaSubagent: true },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/agents/embedded-agent-runner/run.trace-tool-summary.test.ts`
Expected: FAIL — `collectDelegatedToolInvocationsFromInternalEvents` is not exported from `run.ts` yet.

- [ ] **Step 3: Add `collectDelegatedToolInvocationsFromInternalEvents`**

In `src/agents/embedded-agent-runner/run.ts`, import `AgentTaskCompletionInternalEvent`/`AgentInternalEvent` type from `../internal-events.js` if not already imported (check existing imports first — `internalEvents` is already a param here per Task 7's premise, so some import likely already exists; reuse it). Add this function near `buildTraceToolSummary` (before or after it, same file, same section):

```ts
/**
 * Extracts tool evidence a completing subagent already computed, carried on
 * any task_completion internalEvents this attempt consumed. Mirrors the
 * existing collectPendingMediaFromInternalEvents pattern in
 * embedded-agent-subscribe.ts — same idea, different payload. Every
 * returned invocation is tagged viaSubagent so it's distinguishable from
 * tool calls this attempt made directly.
 */
export function collectDelegatedToolInvocationsFromInternalEvents(
  internalEvents: RunEmbeddedAgentParams["internalEvents"],
): { invocations: NonNullable<ToolSummaryTrace["invocations"]>; visibleTools: string[] } {
  if (!internalEvents?.length) {
    return { invocations: [], visibleTools: [] };
  }
  const invocations: NonNullable<ToolSummaryTrace["invocations"]> = [];
  const visibleTools = new Set<string>();
  for (const event of internalEvents) {
    if (event.type !== "task_completion" || !event.childToolEvidence?.length) {
      continue;
    }
    for (const child of event.childToolEvidence) {
      for (const invocation of child.toolInvocations ?? []) {
        invocations.push({ ...invocation, viaSubagent: true });
      }
      for (const tool of child.visibleTools ?? []) {
        visibleTools.add(tool);
      }
    }
  }
  return { invocations, visibleTools: [...visibleTools] };
}
```

If `ToolSummaryTrace`/`RunEmbeddedAgentParams` aren't already imported in `run.ts` at the point `buildTraceToolSummary` is defined, check their existing import there (both types are already used by `buildTraceToolSummary` itself, per its signature, so no new import should be needed).

- [x] **Step 4: Merge at the `attemptToolSummary` computation site** — done, but not as this step originally described.

**Post-implementation note:** a later cubic-dev-ai review round (still on this same PR) found the inline merge below untestable in isolation, so it was extracted into an exported pure function, `mergeDelegatedToolEvidenceIntoSummary` (`run.ts`), which is what actually shipped. The literal string `toolSummary: attemptToolSummary` this step's own instructions ask a reader to grep for **no longer exists anywhere in the file** — there is now a single call site (`mergeDelegatedToolEvidenceIntoSummary(attemptToolSummary, delegatedToolEvidence)`) feeding `mergedAttemptToolSummary`, which each of the (still 4) consumption sites reference. Do not attempt to re-run this step's grep-and-rename procedure; it will find nothing and, if forced, would duplicate the existing helper. Kept below only as the historical record of the first working shape of the merge, before extraction.

At `run.ts:3739` (re-verify current line before editing — Tasks 1-6 don't touch this file), change:

```ts
const attemptToolSummary = buildTraceToolSummary({
  toolMetas: attempt.toolMetas,
  visibleToolNames: attempt.visibleToolNames,
  hadFailure: Boolean(attempt.lastToolError),
  toolFailures: attempt.toolFailures,
});
```

to:

```ts
const attemptToolSummary = buildTraceToolSummary({
  toolMetas: attempt.toolMetas,
  visibleToolNames: attempt.visibleToolNames,
  hadFailure: Boolean(attempt.lastToolError),
  toolFailures: attempt.toolFailures,
});
const delegatedToolEvidence = collectDelegatedToolInvocationsFromInternalEvents(
  params.internalEvents,
);
const mergedAttemptToolSummary =
  delegatedToolEvidence.invocations.length > 0
    ? {
        ...attemptToolSummary,
        invocations: [
          ...(attemptToolSummary?.invocations ?? []),
          ...delegatedToolEvidence.invocations,
        ],
        visibleTools: [
          ...new Set([
            ...(attemptToolSummary?.visibleTools ?? []),
            ...delegatedToolEvidence.visibleTools,
          ]),
        ],
      }
    : attemptToolSummary;
```

Then change the 4 consumption sites (`toolSummary: attemptToolSummary` at the lines the spec cites: `~3816/4059/4150/4289`) to `toolSummary: mergedAttemptToolSummary`. Locate each by searching for the literal string `toolSummary: attemptToolSummary` in this file — there should be exactly 4 matches, all within the same enclosing function as the computation above (confirm this before editing; if a match is in a different function scope where `mergedAttemptToolSummary` isn't in scope, that's a sign the computation needs to move — re-read the surrounding function boundaries before assuming the naive rename is correct).

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/agents/embedded-agent-runner/run.trace-tool-summary.test.ts`
Expected: PASS.

- [ ] **Step 6: Run the full `run.ts` test suite for regressions**

Run: `npx vitest run src/agents/embedded-agent-runner/run.*.test.ts`
Expected: PASS — every existing test in every `run.*.test.ts` file (there are ~10+ per the earlier file listing). This is the most important regression gate in the whole plan: `run.ts` is the file every non-delegating turn also flows through, so this suite passing unmodified is the concrete evidence the "no regressions for the common case" goal holds.

- [ ] **Step 7: Commit**

```bash
git add src/agents/embedded-agent-runner/run.ts src/agents/embedded-agent-runner/run.trace-tool-summary.test.ts
git commit -m "feat(subagent): merge delegated tool evidence into attemptToolSummary"
```

---

## Task 8: end-to-end integration test and full regression sweep

**Files:**

- Test: new integration test file — find this repo's existing convention for an end-to-end embedded-agent-run test that exercises `sessions_spawn`/`sessions_yield` together (search for existing tests referencing both tool names in the same test, e.g. under `src/agents/` or `src/auto-reply/reply/`, to place this alongside its closest existing sibling rather than inventing a new location).

**Interfaces:**

- Consumes: everything from Tasks 1-7 together — this task has no new production code, only a test proving the whole chain works end to end, plus a full-suite regression run.

- [ ] **Step 1: Find the closest existing subagent-spawn-and-yield integration test**

Run: `grep -rl "sessions_spawn" src --include="*.test.ts" | xargs grep -l "sessions_yield"`

Read whichever file(s) this returns to find the existing harness for simulating a full spawn→yield→child-completes→parent-resumes cycle (mock LLM responses, mock tool execution, etc.). Use that exact harness for the new test below — do not build a parallel one.

- [ ] **Step 2: Write the integration test**

Using the harness found in Step 1, add a test that:

1. Simulates a parent turn that calls `sessions_spawn`, then `sessions_yield`.
2. Simulates the spawned child making a real tool call (e.g. a mock `takeoff_dispatch` tool) and replying with text.
3. Simulates the resume (child completion delivered, parent's final attempt runs and replies).
4. Asserts the parent's final reply's `auditTrace.toolInvocations` contains the child's tool call, tagged `viaSubagent: true`.
5. Asserts `auditTrace.disposition` is `"completed"` with `reason: "tool_execution_succeeded"` (not `"no_tools_visible"` — this is the literal disposition flip that fixes the ticket's judge-failure symptom).

Add a second test for the multi-child case: two children complete in the same wake, both tool calls present in the final trace.

Add a third test for the orphaned-child case: simulate a child run with no frozen `resultAuditTrace` (e.g. `completion: { resultText: "done" }` with no `resultAuditTrace` field, matching what an orphaned/never-completed child's registry row looks like per Task 5's error-outcome branch) — assert the parent's final reply still delivers successfully with no crash, and its trace has no delegated evidence (same shape as today's current, unfixed behavior for that case — confirming Task 7's merge truly adds nothing when there's nothing to add, not that it silently swallows an error).

Add a fourth test for the **nested grandchild** case — this is the empirical check for the spec's "comes for free" claim (3.5), which so far is only verified architecturally (one call site, no bypass), not by an actual test exercising two delegation hops: simulate a chain where the top-level parent spawns child C1, C1 itself spawns grandchild C2 and yields on it, C2 makes a real tool call and replies, C1 resumes (picking up C2's evidence via this same mechanism, one hop down) and replies, then the top-level parent resumes and replies. Assert the **top-level parent's** final `auditTrace.toolInvocations` contains C2's tool call, still tagged `viaSubagent: true`, with no special-casing anywhere in the test setup for the nested case — if this test requires anything beyond composing the same single-hop mechanism twice, that's a sign the "comes for free" claim doesn't actually hold and needs to be revisited before this plan is considered complete.

- [ ] **Step 3: Run the new integration tests**

Run: `npx vitest run <path-to-new-test-file>`
Expected: PASS for all four new tests.

- [ ] **Step 4: Run the full test suite**

Run: `npx vitest run`
Expected: PASS — the entire suite, confirming zero regressions anywhere in the repo, not just in the files this plan touched.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "test(subagent): end-to-end coverage for delegated audit-trace evidence (ENG-19951)"
```

- [x] **Step 6: Update the spec's status line** — already done; verify rather than edit.

The spec already carries the target text (`**Status:** implemented, see commits on fix/eng-19951-subagent-audit-trace.`) as shipped, so this step is a verification, not an edit — the "from" text below never existed in the shipped spec. Kept for historical accuracy of what this step originally asked for: change line 4 of `docs/specs/2026-09-18-eng19951-subagent-audit-trace-design.md` from `**Status:** design approved by ticket owner, ready for writing-plans.` to `**Status:** implemented, see commits on fix/eng-19951-subagent-audit-trace.`

```bash
git add docs/specs/2026-09-18-eng19951-subagent-audit-trace-design.md
git commit -m "docs(specs): mark ENG-19951 design as implemented"
```

---

## Self-Review Notes (for whoever executes this plan)

**Two real issues found and fixed during self-review, documented here so the reasoning isn't lost:**

- **Superseded by the Task 3 registry-direct-write redesign below:** Task 5 originally planned to swap which dependency `freezeRunResultAtCompletion` calls. Reading the actual test file (`subagent-registry-lifecycle.test.ts:172-200`) showed `captureSubagentCompletionReply` is a **required** constructor param that ~15 individual tests override per-test — swapping it for a differently-named dependency would have silently broken every one of them (their mocks would simply stop being called). That draft fixed it by adding a new optional `captureSubagentCompletionReplyWithTrace` DI field. **This entire design is moot as shipped**: once Task 3 became a direct registry write (`recordSubagentReplyAuditTrace`, independent of and earlier than the freeze), `freezeRunResultAtCompletion` needed zero changes — see Task 5's own "Superseded design note" below, which is the design that actually shipped. This bullet is kept only as a record of a design path that was considered and abandoned, not as a step to execute.
- **Task 6 initially missed that `runSubagentAnnounceFlow` has a third source for `reply`** — `params.roundOneReply`, a pre-supplied text that bypasses the read-with-trace path entirely. This is now explicitly documented as an acknowledged, deliberate gap (same treatment as the spec's pre-yield-attempt and live-progress-lane scope-outs) rather than silently unhandled.

Both corrections came from actually reading the test files' real structure before writing test code, not from re-deriving it from the spec's citations. Do the same for the remaining lower-confidence items below.

- **Task 6 is the least mechanical task in this plan** — the exact current line numbers/variable names in `subagent-announce.ts` around `reply`/`childCompletionFindings` construction should be re-read from the live file before editing (this plan cites the spec's line numbers, which were accurate as of the spec's writing but this file is untouched by Tasks 1-5, so drift is unlikely but not guaranteed zero). Its Step 1 test also depends on confirming whether the test file's own `deliverSubagentAnnouncement` mock forwards `internalEvents` into the `agent` gateway call params it asserts on — check this before assuming the assertion is meaningful, per the note inline in that step.
- **Task 7 Step 4's "4 consumption sites" claim should be verified by an actual grep** (`grep -n "toolSummary: attemptToolSummary" run.ts`) before assuming exactly 4 matches — the spec cites 4 line numbers from research earlier in this project; confirm the count matches before renaming.
- If any task's test file doesn't have an existing suite to extend in the way described, stop and re-read that file's actual test structure before writing Step 1 — do not guess at a mock shape that doesn't match the file's real conventions. This is what caught both issues above; the same diligence applies to any step still marked "re-verify at implementation time."
