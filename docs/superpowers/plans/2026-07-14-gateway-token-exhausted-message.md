# Gateway Token-Exhausted Message Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the boon LLM gateway returns `{"error":"allocation_exhausted","message":"Token allocation exhausted. Contact sales to upgrade your plan."}`, the agent replies with the exact legacy string `LLM error allocation_exhausted: Token allocation exhausted. Contact sales to upgrade your plan.` instead of the generic `LLM request failed.`

**Architecture:** The desired string is *already* produced by the existing raw-error path in `formatAssistantErrorText` (`isRawApiErrorPayload` → `formatRawAssistantErrorForUi`). The only thing suppressing it is the 6.11 passthrough net `isRawAssistantErrorPassthrough`, which flags any `"LLM error"`-prefixed text as an unsafe raw leak and replaces it with the generic message. The fix is a single narrow exception in `isRawAssistantErrorPassthrough`: when the parsed provider error type is `allocation_exhausted`, treat the text as intended user copy (return `false`), so `formatUserFacingAssistantErrorText` passes it through verbatim. No change to `formatAssistantErrorText`, no change to `failover-matches.ts` (the error stays unclassified for failover, matching pre-6.11 legacy).

**Tech Stack:** TypeScript (ESM, strict), Vitest.

## Global Constraints

- Branch: `williamantoline/gateway-token-exhausted-message`, freshly branched from latest `origin/boon` (currently `4a63a70185`). Does NOT include PR #43 — `failover-matches.ts` has no `allocation_exhausted` / `BOON_GATEWAY_EXHAUSTED_RE` pattern, so `isBillingErrorMessage(body)` is `false` and `formatAssistantErrorText` reaches its raw path. Do not add any billing-lane pattern for this error.
- Exact target reply string (verbatim, note the single space after the colon, ends with a period, no ⚠️): `LLM error allocation_exhausted: Token allocation exhausted. Contact sales to upgrade your plan.`
- Detection key: the parsed provider error `type` equals the literal `"allocation_exhausted"` (a provider error-code contract, same category as the existing `ZAI_BILLING_CODE_1311_RE` / Volcengine `InvalidSubscription` literals). Do not broaden to a fuzzy `exhausted` match.
- Failover behavior must remain unclassified: `classifyFailoverReason(body)` stays `null`, `isBillingErrorMessage(body)` stays `false`.
- File under change is `src/agents/embedded-agent-helpers/errors.ts`; colocated tests in `src/agents/embedded-agent-helpers/errors.test.ts`.
- Tests use `makeAssistantMessageFixture` from `../test-helpers/assistant-message-fixtures.js` (defaults: `stopReason: "error"`, so passing only `errorMessage` yields an errored assistant message). Override `provider`/`model` when relevant.
- Run scoped tests with `node scripts/run-vitest.mjs <path>` from the worktree root (per root AGENTS.md; avoids Vitest watch mode and works in worktree checkouts). Never bare `vitest`.
- Code style: TS strict, no `any`; comments follow the repo rule (1-3 short lines stating why the branch exists and the bad outcome if removed). American spelling.

---

### Task 1: Add the `allocation_exhausted` exception to `isRawAssistantErrorPassthrough`

**Files:**
- Modify: `src/agents/embedded-agent-helpers/errors.ts:1546-1567` (the `isRawAssistantErrorPassthrough` function)
- Test: `src/agents/embedded-agent-helpers/errors.test.ts`

**Interfaces:**
- Consumes: `parseApiErrorInfo(raw?: string): ApiErrorInfo | null` — already imported in `errors.ts` (line 15). `ApiErrorInfo.type?: string` is populated from the flat `{"error":"allocation_exhausted", ...}` payload's `error` string (verified `src/shared/assistant-error-format.ts:191-196`).
- Consumes: `formatUserFacingAssistantErrorText(msg, opts): string` and `formatAssistantErrorText(msg, opts): string | undefined` — existing exports, unchanged.
- Produces: `isRawAssistantErrorPassthrough({ friendlyError, rawError }): boolean` — same signature; now returns `false` early when the raw error's parsed `type === "allocation_exhausted"`.

Current function body (for reference — this is what you are editing):

```ts
export function isRawAssistantErrorPassthrough(params: {
  friendlyError?: string;
  rawError?: string;
}): boolean {
  const friendlyError = params.friendlyError?.trim();
  const rawError = params.rawError?.trim();
  if (!friendlyError || !rawError) {
    return false;
  }
  const parsedMessage = parseApiErrorInfo(rawError)?.message?.trim();
  const leadingStatusRest = extractLeadingHttpStatus(rawError)?.rest?.trim();
  const hasRawDerivedProviderPrefix =
    friendlyError.startsWith("LLM request rejected:") ||
    friendlyError.startsWith("LLM error") ||
    friendlyError.startsWith("HTTP ");
  return (
    friendlyError === rawError ||
    (rawError.length > 600 && friendlyError === `${rawError.slice(0, 600)}…`) ||
    Boolean(parsedMessage && hasRawDerivedProviderPrefix) ||
    Boolean(leadingStatusRest && friendlyError.startsWith("HTTP "))
  );
}
```

- [ ] **Step 1: Write the failing tests**

Add this block to `src/agents/embedded-agent-helpers/errors.test.ts`. First extend the import on line 7 so the symbols are available:

Change:
```ts
import { formatAssistantErrorText, isLikelyContextOverflowError } from "./errors.js";
```
to:
```ts
import {
  classifyFailoverReason,
  formatAssistantErrorText,
  formatUserFacingAssistantErrorText,
  isBillingErrorMessage,
  isLikelyContextOverflowError,
  isRawAssistantErrorPassthrough,
} from "./errors.js";
```

Then append this describe block at the end of the file:

```ts
describe("boon-llm-gateway token allocation exhausted", () => {
  const GATEWAY_BODY =
    '{"error":"allocation_exhausted","message":"Token allocation exhausted. Contact sales to upgrade your plan."}';
  const EXPECTED =
    "LLM error allocation_exhausted: Token allocation exhausted. Contact sales to upgrade your plan.";
  const makeGatewayError = (): AssistantMessage =>
    makeAssistantMessageFixture({
      provider: "boon-llm-gateway",
      model: "claude-opus-4-8",
      errorMessage: GATEWAY_BODY,
      content: [],
    });
  const opts = { provider: "boon-llm-gateway", model: "claude-opus-4-8" };

  it("formatAssistantErrorText renders the raw legacy string (reaches the raw path)", () => {
    // Guards that this error is NOT billing-classified; if it were, billing copy
    // would return before the raw path and the passthrough exception never runs.
    expect(formatAssistantErrorText(makeGatewayError(), opts)).toBe(EXPECTED);
  });

  it("isRawAssistantErrorPassthrough does not suppress the allocation_exhausted string", () => {
    expect(
      isRawAssistantErrorPassthrough({ friendlyError: EXPECTED, rawError: GATEWAY_BODY }),
    ).toBe(false);
  });

  it("formatUserFacingAssistantErrorText surfaces the legacy string instead of the generic fallback", () => {
    // Core regression guard: without the exception this returns "LLM request failed.".
    const text = formatUserFacingAssistantErrorText(makeGatewayError(), opts);
    expect(text).toBe(EXPECTED);
    expect(text).not.toBe("LLM request failed.");
  });

  it("stays unclassified for failover (legacy behavior: no billing lane)", () => {
    expect(classifyFailoverReason(GATEWAY_BODY)).toBe(null);
    expect(isBillingErrorMessage(GATEWAY_BODY)).toBe(false);
  });

  it("does not suppress-exempt an unrelated exhausted code", () => {
    // The exception is keyed strictly to allocation_exhausted; a different code
    // must still be governed by the normal passthrough rules.
    const otherBody = '{"error":"resource_exhausted","message":"retries exhausted"}';
    const otherFriendly = "LLM error resource_exhausted: retries exhausted";
    expect(
      isRawAssistantErrorPassthrough({ friendlyError: otherFriendly, rawError: otherBody }),
    ).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node scripts/run-vitest.mjs src/agents/embedded-agent-helpers/errors.test.ts -t "token allocation exhausted"`

Expected: the `isRawAssistantErrorPassthrough` test FAILS (currently returns `true` for the `"LLM error"`-prefixed string), and the `formatUserFacingAssistantErrorText` test FAILS (currently returns `"LLM request failed."`). The `formatAssistantErrorText`, `classifyFailoverReason`, and `resource_exhausted` tests should already PASS (they assert current correct behavior).

- [ ] **Step 3: Implement the exception**

In `src/agents/embedded-agent-helpers/errors.ts`, edit `isRawAssistantErrorPassthrough`. Replace the line:

```ts
  const parsedMessage = parseApiErrorInfo(rawError)?.message?.trim();
```

with:

```ts
  const parsedInfo = parseApiErrorInfo(rawError);
  // boon-llm-gateway token exhaustion: the raw "LLM error allocation_exhausted: …"
  // text IS the intended user copy (pre-6.11 behavior), not a raw leak. Returning
  // false keeps formatUserFacingAssistantErrorText from replacing it with the
  // generic "LLM request failed.". allocation_exhausted is a provider error-code
  // contract (cf. ZAI 1311 / Volcengine InvalidSubscription).
  if (parsedInfo?.type === "allocation_exhausted") {
    return false;
  }
  const parsedMessage = parsedInfo?.message?.trim();
```

This reuses the single `parseApiErrorInfo(rawError)` call (no second parse) and adds the early exception before the suppression checks.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node scripts/run-vitest.mjs src/agents/embedded-agent-helpers/errors.test.ts -t "token allocation exhausted"`

Expected: all five tests PASS.

- [ ] **Step 5: Run the full file to check for regressions**

Run: `node scripts/run-vitest.mjs src/agents/embedded-agent-helpers/errors.test.ts`

Expected: all tests in the file PASS (the exception is keyed to a specific provider code, so existing passthrough/schema-rejection tests are unaffected).

- [ ] **Step 6: Commit**

```bash
./scripts/committer "fix(agents): surface boon-llm-gateway allocation_exhausted message to user" src/agents/embedded-agent-helpers/errors.ts src/agents/embedded-agent-helpers/errors.test.ts
```

---

### Task 2: Verify the sibling failover-matches suite is untouched and green

**Files:**
- Test (read/run only): `src/agents/embedded-agent-helpers/failover-matches.test.ts`

**Interfaces:**
- Consumes: nothing new. This task only confirms we did NOT reintroduce a billing-lane pattern and that the broader classifier suite still passes.

- [ ] **Step 1: Confirm no `allocation_exhausted` pattern exists in production classifier code**

Run: `grep -rn "allocation_exhausted\|BOON_GATEWAY_EXHAUSTED" src/agents/embedded-agent-helpers/failover-matches.ts`

Expected: no matches (empty output). If anything is found, it is stray PR #43 residue and must be removed — the fresh `boon` branch should have none.

- [ ] **Step 2: Run the failover-matches suite**

Run: `node scripts/run-vitest.mjs src/agents/embedded-agent-helpers/failover-matches.test.ts`

Expected: all tests PASS (unchanged file, sanity check that the branch baseline is clean).

- [ ] **Step 3: No commit**

No code changed in this task; nothing to commit.

---

## Self-Review

**1. Spec coverage:**
- Spec goal (exact legacy string surfaced) → Task 1 Steps 1-4 (`EXPECTED` constant + `formatUserFacingAssistantErrorText` test).
- Spec design (exception in `isRawAssistantErrorPassthrough`, reuse existing parse) → Task 1 Step 3.
- Spec "no change to formatAssistantErrorText" → honored; Task 1 Step 1 test asserts it already returns the string.
- Spec "failover stays unclassified / no billing lane" → Task 1 `classifyFailoverReason`/`isBillingErrorMessage` test + Task 2 grep.
- Spec test list #1-#5 → mapped to the five `it(...)` cases in Task 1 (raw-path render, passthrough unit, end-to-end, failover null, negative/over-match).
- Spec branch-baseline requirement → Global Constraints (fresh `boon`, no billing pattern) + Task 2.
- No gaps found.

**2. Placeholder scan:** No TBD/TODO/"handle edge cases"/"similar to". Every code and command step shows exact content. Clean.

**3. Type consistency:** `isRawAssistantErrorPassthrough` params `{ friendlyError?, rawError? }` and boolean return are consistent between the reference body, the edit, and the tests. `parsedInfo?.type` matches `ApiErrorInfo.type?: string`. The `EXPECTED`/`GATEWAY_BODY` constants are identical everywhere they appear. `makeAssistantMessageFixture` usage matches its `Partial<AssistantMessage>` signature. Consistent.
