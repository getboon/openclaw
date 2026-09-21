# ENG-19951: Subagent Audit-Trace Evidence Implementation Plan

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
- Every task's test command: `npx vitest run <path>` from the repo root (`/Users/williamsboonworkspace/Documents/Documents/workspacee1/openclaw/openclaw/.claude/worktrees/eng-19951-subagent-trace`).

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

## Task 3: extract the subagent's `auditTrace` alongside its text

**Files:**

- Modify: `src/agents/subagent-announce-output.ts:52-70` (`SubagentOutputSnapshot` type, `extractSubagentAssistantText`), `:137-223` (`summarizeSubagentOutputHistory`, `selectSubagentOutputText`), `:225-273` (`readSubagentOutput`, `readLatestSubagentOutputWithRetry`), `:325-339` (`captureSubagentCompletionReply`)
- Test: `src/agents/subagent-announce-output.test.ts`

**Interfaces:**

- Produces: `readSubagentOutputWithTrace(sessionKey, outcome?, options?): Promise<{ text?: string; auditTrace?: AgentDecisionTrace }>` and `captureSubagentCompletionReplyWithTrace(sessionKey, options?): Promise<{ text?: string; auditTrace?: AgentDecisionTrace }>` — new siblings. Task 5 consumes `captureSubagentCompletionReplyWithTrace`; Task 6 consumes `readSubagentOutputWithTrace` for its live-read fallback branch.
- Guarantee: `readSubagentOutput` and `captureSubagentCompletionReply` (existing, exported) keep their exact current signature and behavior — verified by the existing test suite in this file passing unmodified.

- [ ] **Step 1: Write the failing test**

Add to `src/agents/subagent-announce-output.test.ts` (check the existing file's mocking pattern for `readSessionMessagesAsync`/`callGateway` first — reuse whatever fixture/mock helper it already uses for `readSubagentOutput` tests, adapting the message fixture below to that pattern):

```ts
it("readSubagentOutputWithTrace returns the auditTrace attached to the winning message", async () => {
  testing.setDepsForTest({
    readSessionMessagesAsync: async () => [
      {
        role: "assistant",
        content: "All 7 scopes completed.",
        auditTrace: {
          schemaVersion: 1,
          visibleTools: ["takeoff_dispatch"],
          toolInvocations: [{ name: "takeoff_dispatch", status: "ok" }],
          evidence: [{ kind: "tool_outcome", tool: "takeoff_dispatch", status: "ok" }],
          confidence: "high",
          disposition: "completed",
          reason: "tool_execution_succeeded",
        },
      },
    ],
  });
  const result = await readSubagentOutputWithTrace("child-session-key", undefined, {
    sessionFile: "/tmp/fake-session.json",
  });
  expect(result.text).toBe("All 7 scopes completed.");
  expect(result.auditTrace?.toolInvocations).toEqual([{ name: "takeoff_dispatch", status: "ok" }]);
});

it("readSubagentOutputWithTrace omits auditTrace when the winning message has none", async () => {
  testing.setDepsForTest({
    readSessionMessagesAsync: async () => [
      { role: "assistant", content: "Done, no tools needed." },
    ],
  });
  const result = await readSubagentOutputWithTrace("child-session-key", undefined, {
    sessionFile: "/tmp/fake-session.json",
  });
  expect(result.text).toBe("Done, no tools needed.");
  expect(result.auditTrace).toBeUndefined();
});

it("readSubagentOutput (existing, unchanged) still returns only text for the same fixture", async () => {
  testing.setDepsForTest({
    readSessionMessagesAsync: async () => [
      {
        role: "assistant",
        content: "All 7 scopes completed.",
        auditTrace: { schemaVersion: 1, visibleTools: [], toolInvocations: [], evidence: [] },
      },
    ],
  });
  const text = await readSubagentOutput("child-session-key", undefined, {
    sessionFile: "/tmp/fake-session.json",
  });
  expect(text).toBe("All 7 scopes completed.");
});
```

Add `readSubagentOutputWithTrace` and `testing` to this test file's imports from `./subagent-announce-output.js`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/agents/subagent-announce-output.test.ts`
Expected: FAIL — `readSubagentOutputWithTrace` is not exported yet.

- [ ] **Step 3: Extend the transcript-extraction shape**

In `src/agents/subagent-announce-output.ts`, import `AgentDecisionTrace` (same source as Task 2 used).

Change `SubagentOutputSnapshot` (line 52-57):

```ts
type SubagentOutputSnapshot = {
  latestAssistantText?: string;
  latestSilentText?: string;
  latestToolCallCount?: number;
  latestAuditTrace?: AgentDecisionTrace;
  waitingForContinuation?: boolean;
};
```

Add a small extractor mirroring `extractSubagentAssistantText` (line 102-115), placed right after it:

```ts
function extractSubagentAssistantAuditTrace(message: unknown): AgentDecisionTrace | undefined {
  if (!message || typeof message !== "object") {
    return undefined;
  }
  const record = message as { role?: unknown; auditTrace?: unknown };
  if (record.role !== "assistant" || !record.auditTrace || typeof record.auditTrace !== "object") {
    return undefined;
  }
  return record.auditTrace as AgentDecisionTrace;
}
```

In `summarizeSubagentOutputHistory` (line 137-184), the branch that sets `snapshot.latestAssistantText = text` (currently lines 168-171) is the ONE place the winning text gets selected — set the trace in the same branch, same message:

```ts
snapshot.latestSilentText = undefined;
snapshot.latestAssistantText = text;
snapshot.latestAuditTrace = extractSubagentAssistantAuditTrace(message);
snapshot.waitingForContinuation = false;
previousAssistantCalledYield = false;
continue;
```

Every OTHER branch in this loop that clears `latestAssistantText`/`latestSilentText` (there are three: the `assistantCallsSessionsYield` branch ~line 147-151, the empty-text branch ~154-160, and the `isAnnounceSkip`/silent branch ~161-167) must also clear `latestAuditTrace` to `undefined` — a stale trace from an earlier message must never survive past a later message that supersedes it. Add `snapshot.latestAuditTrace = undefined;` to each of those three branches.

- [ ] **Step 4: Add the `WithTrace` sibling functions**

Add a new function right after `selectSubagentOutputText` (line 209-223) that returns both fields:

```ts
function selectSubagentOutputResult(snapshot: SubagentOutputSnapshot): {
  text?: string;
  auditTrace?: AgentDecisionTrace;
} {
  const text = selectSubagentOutputText(snapshot);
  if (!text) {
    return {};
  }
  // Only the branch that set latestAssistantText also sets latestAuditTrace
  // (Step 3) — a silent/tool-call-count fallback text never carries a trace,
  // which is correct: there's no assistant message with real evidence to
  // attach in those cases.
  return text === snapshot.latestAssistantText
    ? { text, auditTrace: snapshot.latestAuditTrace }
    : { text };
}
```

Add `readSubagentOutputWithTrace` as a near-duplicate of `readSubagentOutput` (line 225-259) that shares the same transcript-fetch logic but returns the richer result. Refactor `readSubagentOutput` to call it, rather than duplicating the fetch:

```ts
export async function readSubagentOutputWithTrace(
  sessionKey: string,
  _outcome?: SubagentRunOutcome,
  options?: { sessionFile?: string },
): Promise<{ text?: string; auditTrace?: AgentDecisionTrace }> {
  let messages: unknown[] | undefined;
  if (options?.sessionFile) {
    const transcriptMessages = await subagentAnnounceOutputDeps.readSessionMessagesAsync(
      {
        sessionFile: options.sessionFile,
        sessionId: sessionKey,
      },
      {
        mode: "recent",
        maxMessages: 100,
        maxBytes: 1024 * 1024,
      },
    );
    messages = transcriptMessages;
  }
  const history =
    messages === undefined
      ? await subagentAnnounceOutputDeps.callGateway({
          method: "chat.history",
          params: { sessionKey, limit: 100 },
        })
      : undefined;
  const sourceMessages = messages ?? (Array.isArray(history?.messages) ? history.messages : []);
  const snapshot = summarizeSubagentOutputHistory(sourceMessages);
  const result = selectSubagentOutputResult(snapshot);
  return result.text?.trim() ? result : {};
}

export async function readSubagentOutput(
  sessionKey: string,
  outcome?: SubagentRunOutcome,
  options?: { sessionFile?: string },
): Promise<string | undefined> {
  const { text } = await readSubagentOutputWithTrace(sessionKey, outcome, options);
  return text;
}
```

This removes the duplicated fetch body from `readSubagentOutput` (it now delegates) — same transcript is read once, same behavior, confirmed by Step 1's third test.

Now add `captureSubagentCompletionReplyWithTrace`, mirroring `captureSubagentCompletionReply` (line 325-339) and its dependency `captureSubagentCompletionReplyUsing` (`subagent-announce-capture.ts:38`, which only accepts a `string`-returning reader). Rather than widen that shared low-level helper's type (touching a file with its own retry-loop tests, unnecessary risk for this fix), write a small dedicated wrapper here:

```ts
export async function captureSubagentCompletionReplyWithTrace(
  sessionKey: string,
  options?: { waitForReply?: boolean; outcome?: SubagentRunOutcome; sessionFile?: string },
): Promise<{ text?: string; auditTrace?: AgentDecisionTrace }> {
  const immediate = await readSubagentOutputWithTrace(sessionKey, options?.outcome, {
    sessionFile: options?.sessionFile,
  });
  if (immediate.text?.trim()) {
    return immediate;
  }
  if (options?.waitForReply === false) {
    return {};
  }
  const maxWaitMs = isFastTestMode() ? 50 : 1_500;
  const retryIntervalMs = isFastTestMode() ? FAST_TEST_RETRY_INTERVAL_MS : 100;
  let waitedMs = 0;
  let result: { text?: string; auditTrace?: AgentDecisionTrace } = {};
  while (waitedMs < maxWaitMs) {
    result = await readSubagentOutputWithTrace(sessionKey, options?.outcome, {
      sessionFile: options?.sessionFile,
    });
    if (result.text?.trim()) {
      return result;
    }
    const remainingMs = maxWaitMs - waitedMs;
    if (remainingMs <= 0) {
      break;
    }
    const sleepMs = Math.min(retryIntervalMs, remainingMs);
    await new Promise((resolve) => {
      setTimeout(resolve, sleepMs);
    });
    waitedMs += sleepMs;
  }
  return result;
}
```

(This duplicates the retry-loop shape of `readLatestSubagentOutputWithRetryUsing`/`captureSubagentCompletionReplyUsing` in `subagent-announce-capture.ts` rather than generalizing that shared file — the design spec's "one change, one file" additive principle takes priority over DRY here, since generalizing a tested low-level shared utility's return type is exactly the kind of touch-something-shared risk this fix is designed to avoid.)

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/agents/subagent-announce-output.test.ts`
Expected: PASS — all new tests, and every pre-existing test in this file (confirms `readSubagentOutput`'s behavior is unchanged after the refactor).

- [ ] **Step 6: Commit**

```bash
git add src/agents/subagent-announce-output.ts src/agents/subagent-announce-output.test.ts
git commit -m "feat(subagent): extract auditTrace alongside text when reading subagent output"
```

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

## Task 5: freeze the trace onto the registry at completion

**Files:**

- Modify: `src/agents/subagent-registry-lifecycle.ts:399-424` (`freezeRunResultAtCompletion`), `:450-479` (`refreshFrozenResultFromSession`), `:527-552` (`loadPendingFinalDeliveryPayload`), `:567-585` (`refreshPendingFinalDeliveryPayload`), and the `createSubagentRegistryLifecycleController` params type (`:124-150`)
- Modify: `src/agents/subagent-announce.ts` — add `export { captureSubagentCompletionReplyWithTrace } from "./subagent-announce-output.js";` next to the existing `captureSubagentCompletionReply` re-export (line 91)
- Modify: `src/agents/subagent-registry.ts:104,113,150-151,598-599` — wire the new dep through `SubagentAnnounceModule`, `subagentRegistryDeps`, and the controller construction, mirroring `captureSubagentCompletionReply`'s existing wiring exactly
- Test: `src/agents/subagent-registry-lifecycle.test.ts`

**Interfaces:**

- Consumes: `captureSubagentCompletionReplyWithTrace` from Task 3, `resultAuditTrace`/`frozenAuditTrace` fields from Task 4.
- Produces: a subagent run's registry row has `completion.resultAuditTrace` populated whenever `completion.resultText` is (same freeze moment, same condition), and `PendingFinalDeliveryPayload.frozenAuditTrace` mirrors `frozenResultText` at both sites that build that payload.

**Critical constraint found while reading the actual test file** (this correction replaces an earlier draft of this task that would have broken every existing test in `subagent-registry-lifecycle.test.ts`): `createSubagentRegistryLifecycleController`'s params type declares `captureSubagentCompletionReply: CaptureSubagentCompletionReply` as a **required** field (`subagent-registry-lifecycle.ts:150`), and this file's test helper `createLifecycleController` (`subagent-registry-lifecycle.test.ts:172-200`) supplies a default (`captureSubagentCompletionReply: vi.fn(async () => "final completion reply")`) that ~15 individual tests override per-test via `vi.fn(...)`. **Do not rename or replace this field** — every one of those ~15 tests would silently stop freezing any result at all, since their mock would no longer be the function actually called. Instead, add `captureSubagentCompletionReplyWithTrace` as a **new, optional** field, and have `freezeRunResultAtCompletion`/`refreshFrozenResultFromSession` prefer it when present, falling back to the existing required field when absent. This is the same additive-optional-field pattern used everywhere else in this plan, applied to a dependency-injection parameter instead of a data type — same reasoning, same guarantee: every test that doesn't know about the new field is unaffected.

- [ ] **Step 1: Write the failing test**

Read `src/agents/subagent-registry-lifecycle.test.ts` lines 104-200 (`createRunEntry`, `createLifecycleController`) and lines 919-949 (`"does not freeze stale reply text for terminal error outcomes"`) before writing this — the tests below reuse those exact helpers. Add to the `describe("subagent registry lifecycle hardening", ...)` block:

```ts
it("freezes resultAuditTrace alongside resultText when captureSubagentCompletionReplyWithTrace is provided", async () => {
  const entry = createRunEntry({
    expectsCompletionMessage: true,
  });
  const auditTrace = {
    schemaVersion: 1 as const,
    visibleTools: ["takeoff_dispatch"],
    toolInvocations: [{ name: "takeoff_dispatch", status: "ok" as const }],
    evidence: [{ kind: "tool_outcome" as const, tool: "takeoff_dispatch", status: "ok" as const }],
    confidence: "high" as const,
    disposition: "completed" as const,
    reason: "tool_execution_succeeded" as const,
  };
  const captureSubagentCompletionReplyWithTrace = vi.fn(async () => ({
    text: "All 7 scopes completed.",
    auditTrace,
  }));

  const controller = createLifecycleController({
    entry,
    captureSubagentCompletionReplyWithTrace,
  });

  await expect(
    controller.completeSubagentRun({
      runId: entry.runId,
      endedAt: 4_000,
      outcome: { status: "ok" },
      reason: SUBAGENT_ENDED_REASON_COMPLETE,
      triggerCleanup: false,
    }),
  ).resolves.toBeUndefined();

  expect(entry.completion?.resultText).toBe("All 7 scopes completed.");
  expect(entry.completion?.resultAuditTrace).toEqual(auditTrace);
});

it("falls back to the text-only capture when captureSubagentCompletionReplyWithTrace is not provided", async () => {
  const entry = createRunEntry({
    expectsCompletionMessage: true,
  });
  const controller = createLifecycleController({
    entry,
    captureSubagentCompletionReply: vi.fn(async () => "final completion reply"),
  });

  await expect(
    controller.completeSubagentRun({
      runId: entry.runId,
      endedAt: 4_000,
      outcome: { status: "ok" },
      reason: SUBAGENT_ENDED_REASON_COMPLETE,
      triggerCleanup: false,
    }),
  ).resolves.toBeUndefined();

  expect(entry.completion?.resultText).toBe("final completion reply");
  expect(entry.completion?.resultAuditTrace).toBeUndefined();
});

it("freezes neither resultText nor resultAuditTrace on an error outcome, even with trace capture provided", async () => {
  const entry = createRunEntry({
    expectsCompletionMessage: true,
  });
  const captureSubagentCompletionReplyWithTrace = vi.fn(async () => ({
    text: "stale assistant text",
    auditTrace: { schemaVersion: 1 as const, visibleTools: [], toolInvocations: [], evidence: [] },
  }));

  const controller = createLifecycleController({
    entry,
    captureSubagentCompletionReplyWithTrace,
  });

  await expect(
    controller.completeSubagentRun({
      runId: entry.runId,
      endedAt: 4_000,
      outcome: { status: "error", error: "All models failed (2): timeout" },
      reason: SUBAGENT_ENDED_REASON_COMPLETE,
      triggerCleanup: false,
    }),
  ).resolves.toBeUndefined();

  expect(captureSubagentCompletionReplyWithTrace).not.toHaveBeenCalled();
  expect(entry.completion?.resultText).toBeNull();
  expect(entry.completion?.resultAuditTrace).toBeUndefined();
});
```

Also add `captureSubagentCompletionReplyWithTrace: undefined` is NOT needed in the base `params` object inside `createLifecycleController` (line 180-197) — since the field is optional, omitting it entirely from the defaults is correct and is exactly what makes the second new test above ("falls back...") exercise the true default path.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/agents/subagent-registry-lifecycle.test.ts`
Expected: FAIL — TypeScript error on `captureSubagentCompletionReplyWithTrace` (field doesn't exist on the params type yet), and `entry.completion?.resultAuditTrace` is `undefined` in the first new test.

- [ ] **Step 3: Add the optional dep and update `freezeRunResultAtCompletion`**

In `src/agents/subagent-registry-lifecycle.ts`, near line 69 where `CaptureSubagentCompletionReply` is type-aliased from `subagent-announce.js`, add a sibling alias:

```ts
type CaptureSubagentCompletionReplyWithTrace =
  (typeof import("./subagent-announce.js"))["captureSubagentCompletionReplyWithTrace"];
```

In the `createSubagentRegistryLifecycleController(params: {...})` type (starting line 124), add after the existing `captureSubagentCompletionReply: CaptureSubagentCompletionReply;` (line 150):

```ts
  /**
   * Optional: when provided, freezing also captures the subagent's own
   * audit trace alongside its text (ENG-19951). Optional so every existing
   * caller/test that only supplies captureSubagentCompletionReply keeps
   * working unmodified — freezeRunResultAtCompletion falls back to the
   * text-only capture when this is absent.
   */
  captureSubagentCompletionReplyWithTrace?: CaptureSubagentCompletionReplyWithTrace;
```

Change `freezeRunResultAtCompletion` (lines 399-424):

```ts
const freezeRunResultAtCompletion = async (
  entry: SubagentRunRecord,
  outcome: SubagentRunOutcome,
): Promise<boolean> => {
  const completion = ensureCompletionState(entry);
  if (completion.resultText !== undefined) {
    return false;
  }
  if (outcome.status === "error") {
    completion.resultText = null;
    completion.capturedAt = Date.now();
    return true;
  }
  try {
    const captured = params.captureSubagentCompletionReplyWithTrace
      ? await params.captureSubagentCompletionReplyWithTrace(entry.childSessionKey, {
          waitForReply: entry.expectsCompletionMessage === true,
          outcome,
          sessionFile: entry.execution?.transcriptFile,
        })
      : {
          text: await params.captureSubagentCompletionReply(entry.childSessionKey, {
            waitForReply: entry.expectsCompletionMessage === true,
            outcome,
            sessionFile: entry.execution?.transcriptFile,
          }),
        };
    completion.resultText = captured.text?.trim() ? capFrozenResultText(captured.text) : null;
    completion.resultAuditTrace = captured.text?.trim() ? captured.auditTrace : undefined;
  } catch {
    completion.resultText = null;
    completion.resultAuditTrace = undefined;
  }
  completion.capturedAt = Date.now();
  return true;
};
```

Change `refreshFrozenResultFromSession` (lines 450-479) the same way — its single `captured = await params.captureSubagentCompletionReply(sessionKey);` call (line 460) becomes:

```ts
let captured: { text?: string; auditTrace?: AgentDecisionTrace } | undefined;
try {
  captured = params.captureSubagentCompletionReplyWithTrace
    ? await params.captureSubagentCompletionReplyWithTrace(sessionKey)
    : { text: await params.captureSubagentCompletionReply(sessionKey) };
} catch {
  return false;
}
const trimmed = captured?.text?.trim();
```

(replacing the existing `let captured: string | undefined;` / `captured = await params.captureSubagentCompletionReply(sessionKey);` / `const trimmed = captured?.trim();` trio at lines 458-464), and inside the `for (const entry of candidates)` loop, alongside the existing `completion.resultText = nextFrozen;` (line 477), add `completion.resultAuditTrace = captured?.auditTrace;`.

- [ ] **Step 4: Update both `PendingFinalDeliveryPayload`-building sites**

In `loadPendingFinalDeliveryPayload` (lines 527-552), add after line 546 (`frozenResultText: ...`):

```ts
      frozenAuditTrace: entry.delivery?.payload?.frozenAuditTrace ?? entry.completion?.resultAuditTrace,
```

In `refreshPendingFinalDeliveryPayload` (lines 567-585), add after line 581 (`frozenResultText: entry.completion?.resultText,`):

```ts
      frozenAuditTrace: entry.completion?.resultAuditTrace,
```

- [ ] **Step 5: Wire the new dep into production (`subagent-announce.ts`, `subagent-registry.ts`)**

In `src/agents/subagent-announce.ts`, add next to line 91's existing re-export:

```ts
export { captureSubagentCompletionReplyWithTrace } from "./subagent-announce-output.js";
```

In `src/agents/subagent-registry.ts`:

- Line 104's `Pick<..., "captureSubagentCompletionReply" | "runSubagentAnnounceFlow">`-style type union: add `| "captureSubagentCompletionReplyWithTrace"`.
- Line 113's `captureSubagentCompletionReply: SubagentAnnounceModule["captureSubagentCompletionReply"];` in the deps type: add a sibling line `captureSubagentCompletionReplyWithTrace: SubagentAnnounceModule["captureSubagentCompletionReplyWithTrace"];`.
- Lines 150-151's lazy-loaded default:
  ```ts
  captureSubagentCompletionReplyWithTrace: async (sessionKey, options) =>
    (await loadSubagentAnnounceModule()).captureSubagentCompletionReplyWithTrace(sessionKey, options),
  ```
- Lines 598-599's controller construction, add:
  ```ts
  captureSubagentCompletionReplyWithTrace: (sessionKey, options) =>
    subagentRegistryDeps.captureSubagentCompletionReplyWithTrace(sessionKey, options),
  ```

This is the one place a production caller must be updated for Task 5's fix to actually take effect outside tests — without this step, `freezeRunResultAtCompletion`'s optional-field fallback means the code still runs correctly, it just never freezes a trace in production (silently falls back to text-only forever). Do not skip this step.

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run src/agents/subagent-registry-lifecycle.test.ts`
Expected: PASS — the 3 new tests, and every one of the ~15 pre-existing tests that supply only `captureSubagentCompletionReply` (confirms the optional-field fallback truly preserves their behavior).

- [ ] **Step 7: Commit**

```bash
git add src/agents/subagent-registry-lifecycle.ts src/agents/subagent-announce.ts src/agents/subagent-registry.ts src/agents/subagent-registry-lifecycle.test.ts
git commit -m "feat(subagent): freeze resultAuditTrace alongside resultText at completion"
```

---

## Task 6: populate `childToolEvidence` on the completion event (single-child and multi-child)

**Files:**

- Modify: `src/agents/subagent-announce-output.ts:366-438` (`ChildCompletionRow` type, `selectChildCompletionResultText`, `buildChildCompletionFindings`)
- Modify: `src/agents/subagent-announce.ts:242-544` (`runSubagentAnnounceFlow` — the `completionEvent` construction, ~line 531 in the pre-plan version; verify the exact current line via the file's own content before editing, since Tasks 1-5 don't touch this file so line numbers here are stable from the spec's own citations)
- Test: `src/agents/subagent-announce.test.ts`, `src/agents/subagent-announce-output.test.ts`

**Interfaces:**

- Consumes: `SubagentToolEvidence` (Task 2), `resultAuditTrace`/`frozenAuditTrace` (Tasks 4-5), `readSubagentOutputWithTrace` (Task 3).
- Produces: `completionEvent.childToolEvidence` populated for both the single-child direct path and the multi-child `buildChildCompletionFindings` wake path — this is what `run.ts` (Task 7) reads.

**Known, deliberate gap in this task** (read before writing code): `runSubagentAnnounceFlow` has a _third_ source for `reply` besides the two read-based call sites this task instruments — `params.roundOneReply`, a pre-supplied text the caller already had in hand (used when the flow is invoked synchronously right after a run ends, avoiding a redundant transcript read). When `roundOneReply` is set, `reply` never goes through `readSubagentOutputWithTrace`/`readLatestSubagentOutputWithRetry`, so this task's `childToolEvidence` population is skipped for that path — same as today's (unfixed) behavior, not worse. This is intentionally out of scope here, the same way the spec scopes out pre-yield-attempt evidence: the ticket's proven case (and the general async-wait case this fix targets) goes through the read-based path, not `roundOneReply`. If a future case shows `roundOneReply`-sourced completions also need evidence, that's a follow-up, not a blocker for this task.

- [ ] **Step 1: Write the failing test — single child**

Read `src/agents/subagent-announce.test.ts` lines 1-240 (mock setup, `runCompletionFixture`) before writing this. The default fixture sets `roundOneReply: "done"`, which (per the gap above) bypasses the read path entirely — override it to `undefined` so the flow actually calls `readSubagentOutputWithTrace`/`readLatestSubagentOutputWithRetry`. This requires making `readSessionMessagesAsync`'s mock return value controllable per-test: change line 67's inline `readSessionMessagesAsync: vi.fn(async () => [])` to reference a hoisted mock instead, so a test can override its resolved value.

Add near the top of the file, alongside the other `vi.hoisted`/const mock declarations (e.g. near line 36's `deliverSubagentAnnouncementArgsMock`):

```ts
const readSessionMessagesAsyncMock = vi.fn(
  async (_target: unknown, _opts: unknown) => [] as unknown[],
);
```

Change line 67 from `readSessionMessagesAsync: vi.fn(async () => []),` to `readSessionMessagesAsync: readSessionMessagesAsyncMock,`.

Add the test, in `describe("subagent announce seam flow", ...)`:

```ts
it("populates childToolEvidence on the completion event when the child's transcript carries an audit trace", async () => {
  readSessionMessagesAsyncMock.mockResolvedValueOnce([
    {
      role: "assistant",
      content: "All 7 scopes completed.",
      auditTrace: {
        schemaVersion: 1,
        visibleTools: ["takeoff_dispatch"],
        toolInvocations: [{ name: "takeoff_dispatch", status: "ok" }],
        evidence: [{ kind: "tool_outcome", tool: "takeoff_dispatch", status: "ok" }],
        confidence: "high",
        disposition: "completed",
        reason: "tool_execution_succeeded",
      },
    },
  ]);

  await runCompletionFixture({ roundOneReply: undefined });

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

Where `completionEvent: AgentInternalEvent` is constructed (spec cites ~line 531; re-verify the exact current line in this file before editing, since it's unmodified by prior tasks), add `childToolEvidence`:

```ts
const directChildToolEvidence: SubagentToolEvidence[] = childCompletionFindings
  ? [] // multi-child path fills this below, before completionEvent is built
  : replyAuditTrace?.toolInvocations?.length
    ? [
        {
          childSessionKey: params.childSessionKey,
          toolInvocations: replyAuditTrace.toolInvocations,
          visibleTools: replyAuditTrace.visibleTools ?? [],
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

`replyAuditTrace` needs to be threaded from wherever `reply` is set (the single-child path, lines ~408-422 in the spec's citation): change the two call sites that currently do `reply = await readSubagentOutput(...)` / `reply = await readLatestSubagentOutputWithRetry(...)` to instead call the `WithTrace` variants and destructure both `text`/`auditTrace`, keeping `reply` assigned to the text (so every existing downstream use of `reply` as a string is untouched) while also capturing `replyAuditTrace` in an outer-scoped `let replyAuditTrace: AgentDecisionTrace | undefined;` declared alongside `let reply = params.roundOneReply;` near the top of the function.

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

- [ ] **Step 4: Merge at the `attemptToolSummary` computation site**

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

- [ ] **Step 6: Update the spec's status line**

Change line 4 of `docs/specs/2026-09-18-eng19951-subagent-audit-trace-design.md` from `**Status:** design approved by ticket owner, ready for writing-plans.` to `**Status:** implemented, see commits on fix/eng-19951-subagent-audit-trace.`

```bash
git add docs/specs/2026-09-18-eng19951-subagent-audit-trace-design.md
git commit -m "docs(specs): mark ENG-19951 design as implemented"
```

---

## Self-Review Notes (for whoever executes this plan)

**Two real issues found and fixed during self-review, documented here so the reasoning isn't lost:**

- **Task 5 originally planned to swap which dependency `freezeRunResultAtCompletion` calls.** Reading the actual test file (`subagent-registry-lifecycle.test.ts:172-200`) showed `captureSubagentCompletionReply` is a **required** constructor param that ~15 individual tests override per-test — swapping it for a differently-named dependency would have silently broken every one of them (their mocks would simply stop being called). Fixed by adding `captureSubagentCompletionReplyWithTrace` as a new **optional** field with a fallback to the existing required one, the same additive pattern used everywhere else in this plan, just applied to a DI parameter instead of a data field. Task 5 as written now includes the `subagent-registry.ts` production wiring this requires — don't skip that step, or the fix compiles and tests pass but never actually freezes a trace outside tests.
- **Task 6 initially missed that `runSubagentAnnounceFlow` has a third source for `reply`** — `params.roundOneReply`, a pre-supplied text that bypasses the read-with-trace path entirely. This is now explicitly documented as an acknowledged, deliberate gap (same treatment as the spec's pre-yield-attempt and live-progress-lane scope-outs) rather than silently unhandled.

Both corrections came from actually reading the test files' real structure before writing test code, not from re-deriving it from the spec's citations. Do the same for the remaining lower-confidence items below.

- **Task 6 is the least mechanical task in this plan** — the exact current line numbers/variable names in `subagent-announce.ts` around `reply`/`childCompletionFindings` construction should be re-read from the live file before editing (this plan cites the spec's line numbers, which were accurate as of the spec's writing but this file is untouched by Tasks 1-5, so drift is unlikely but not guaranteed zero). Its Step 1 test also depends on confirming whether the test file's own `deliverSubagentAnnouncement` mock forwards `internalEvents` into the `agent` gateway call params it asserts on — check this before assuming the assertion is meaningful, per the note inline in that step.
- **Task 7 Step 4's "4 consumption sites" claim should be verified by an actual grep** (`grep -n "toolSummary: attemptToolSummary" run.ts`) before assuming exactly 4 matches — the spec cites 4 line numbers from research earlier in this project; confirm the count matches before renaming.
- If any task's test file doesn't have an existing suite to extend in the way described, stop and re-read that file's actual test structure before writing Step 1 — do not guess at a mock shape that doesn't match the file's real conventions. This is what caught both issues above; the same diligence applies to any step still marked "re-verify at implementation time."
