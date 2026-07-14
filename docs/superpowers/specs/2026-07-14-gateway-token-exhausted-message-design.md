# Design: Surface the boon-llm-gateway token-exhaustion message to the user

Date: 2026-07-14
Branch: new branch from `boon` (does **not** include PR #43)

## Problem

When the boon LLM gateway rejects an exhausted token allocation, it returns HTTP 429 with the flat body:

```json
{"error":"allocation_exhausted","message":"Token allocation exhausted. Contact sales to upgrade your plan."}
```

The agent should reply to the user with the exact legacy string:

```
LLM error allocation_exhausted: Token allocation exhausted. Contact sales to upgrade your plan.
```

Today (on `boon`, post the v2026.6.11 upstream merge #31) the user instead sees the bare generic string `LLM request failed.`

## Root cause

The reply text is produced by two layers in `src/agents/embedded-agent-helpers/errors.ts`:

1. `formatAssistantErrorText(msg, opts)` — classifies the error and returns "friendly" text. For this body it falls through to the raw path (`isLikelyHttpErrorText || isRawApiErrorPayload`, `errors.ts:1531`) and `formatRawAssistantErrorForUi` renders `LLM error allocation_exhausted: Token allocation exhausted. Contact sales to upgrade your plan.` **This is already the desired string — it is produced correctly today.**
2. `formatUserFacingAssistantErrorText(msg, opts)` — the actual user-facing entry point (called from `embedded-agent-runner/run/payloads.ts:342` and `embedded-agent-subscribe.handlers.lifecycle.ts:130`). It runs `isRawAssistantErrorPassthrough` over the friendly text; any text starting with `"LLM error"` (with a parsed provider message) is treated as an unsafe raw passthrough and **replaced with `GENERIC_ASSISTANT_ERROR_TEXT` = `"LLM request failed."`** (`errors.ts:1546-1592`).

The `formatUserFacingAssistantErrorText` + `isRawAssistantErrorPassthrough` suppression net is **new in the 6.11 merge (#31)** — it is part of `boon`, not part of PR #43. Pre-6.11 (`src/agents/pi-embedded-helpers/errors.ts`) had no such net, which is the only reason the message showed through then.

Therefore the regression is purely the suppression net eating an already-correct string. **The fix is to stop the net from suppressing this specific gateway error.**

## Legacy (pre-6.11) behavior we are matching

Verified against the pre-6.11 boon commit `8df5ff9974ba44f0a9bff14b50483bff742ed741` (files under `src/agents/pi-embedded-helpers/`):

- `isBillingErrorMessage` had **no** `allocation`/`exhausted` pattern, so this error was **not** in the billing lane. It fell through as unclassified (`classifyFailoverReason` → `null`): a single attempt, **no** auth-profile disable, **no** session suspend.
- Display text was produced by the `isLikelyHttpErrorText || isRawApiErrorPayload` branch → `formatRawAssistantErrorForUi` → **`LLM error allocation_exhausted: Token allocation exhausted. Contact sales to upgrade your plan.`** It was shown as-is because no passthrough/suppression net existed at that commit (`git grep` for `isRawAssistantErrorPassthrough`/`formatUserFacingAssistantErrorText` = zero matches).

The chosen target string is **byte-for-byte the legacy string** (no ⚠️, with the `LLM error allocation_exhausted:` prefix). The same three functions that produced it in legacy (`isRawApiErrorPayload`, `parseApiErrorInfo`, `formatRawAssistantErrorForUi`) still exist and behave identically on `boon`; only the new suppression net stands in the way.

PR #43 changed the *classification* (added `BOON_GATEWAY_EXHAUSTED_RE` to the billing lane). We are **not** including that. Failover behavior stays as legacy `boon` = unclassified.

## Goals

- Agent reply for the gateway token-exhaustion body is exactly the legacy string: `LLM error allocation_exhausted: Token allocation exhausted. Contact sales to upgrade your plan.`
- The string continues to be produced by the existing raw-formatting path (no new copy is written); we only prevent the suppression net from replacing it.
- Failover behavior matches legacy: error is **unclassified** (no billing lane, no auth-profile disable, no session suspend).

## Non-goals

- No change to `formatAssistantErrorText` (the raw path already produces the correct string).
- No change to `failover-matches.ts` classification (no billing/rate-limit/auth reason for this error).
- No new config or env surface.
- No change to any other provider's error handling. The exception is narrowly keyed to the `allocation_exhausted` provider code.

## Design

Single change in `isRawAssistantErrorPassthrough` (`src/agents/embedded-agent-helpers/errors.ts:1546-1567`): add an early exception so the boon-llm-gateway token-exhaustion payload is **not** treated as a suppressible raw passthrough. Because `formatAssistantErrorText` already returns the correct `LLM error allocation_exhausted: …` string, returning `false` here lets `formatUserFacingAssistantErrorText` pass it through verbatim.

Detection reuses the `parseApiErrorInfo(rawError)` call that the function already performs (no second parse), keying on the parsed `type === "allocation_exhausted"`.

Reference snippet (inside `isRawAssistantErrorPassthrough`, replacing the existing single `parsedMessage` line so the parse is shared):

```ts
  const friendlyError = params.friendlyError?.trim();
  const rawError = params.rawError?.trim();
  if (!friendlyError || !rawError) {
    return false;
  }
  const parsedInfo = parseApiErrorInfo(rawError);
  // boon-llm-gateway token exhaustion: the raw "LLM error allocation_exhausted: …"
  // text IS the intended user copy (matches pre-6.11 behavior), not a raw leak.
  // Do not let the passthrough net swallow it to "LLM request failed.".
  // `allocation_exhausted` is a provider error-code contract (cf. ZAI 1311 /
  // Volcengine InvalidSubscription).
  if (parsedInfo?.type === "allocation_exhausted") {
    return false;
  }
  const parsedMessage = parsedInfo?.message?.trim();
  const leadingStatusRest = extractLeadingHttpStatus(rawError)?.rest?.trim();
  // …remainder of the function unchanged…
```

### Why keying on the parsed type is safe

- `parseApiErrorInfo` reads the flat `{"error":"allocation_exhausted","message":"..."}` shape: the `error` string populates `type`, the top-level `message` populates `message` (verified `assistant-error-format.ts:191-196`). So `parsedInfo.type === "allocation_exhausted"` fires exactly for this gateway payload.
- The exception returns `false` (i.e. "not a passthrough, keep the friendly text"). The friendly text in this case is the already-correct `LLM error allocation_exhausted: …` from `formatAssistantErrorText`.
- `formatUserFacingAssistantErrorText`'s other guard, `rawProviderSchemaError`, is also false for this body (`parsedErrorType` = `"allocation_exhausted"`, does not include `"invalid_request"`; friendly text does not start with `"LLM request rejected:"`), so `safeFriendlyError` = the friendly string → returned verbatim.
- Both user-facing surfaces (`payloads.ts:342` reply, `lifecycle.ts:130` event) route through `formatUserFacingAssistantErrorText`, so both surface the string.

### Trade-off acknowledged

`isRawAssistantErrorPassthrough` is a general safety net that stops raw `LLM error …` payloads from leaking to users. This change pokes a **provider-specific hole** in it. That is accepted because (a) for `allocation_exhausted` the raw text is *intended* user copy, not a leak, and (b) `allocation_exhausted` is a provider error-code contract, the same category of literal already present in the tree (`ZAI_BILLING_CODE_1311_RE`, Volcengine `InvalidSubscription`). The hole is keyed to a single, specific provider code, not a broad pattern.

## Files touched

- `src/agents/embedded-agent-helpers/errors.ts` — add the `allocation_exhausted` exception in `isRawAssistantErrorPassthrough` (reusing the existing `parseApiErrorInfo` call) + short contract comment.
- `src/agents/embedded-agent-helpers/errors.test.ts` — add tests.

**Branch baseline:** implement on a fresh branch from `boon`. If the work instead builds on the current `williamantoline/gateway-allocation-exhausted-billing` branch (which contains PR #43's `aa76bf36a8`), then to match legacy failover behavior we must also **remove** the `BOON_GATEWAY_EXHAUSTED_RE` billing-lane entry in `failover-matches.ts` (declaration + `ERROR_PATTERNS.billing` entry + `isBillingErrorMessage` >512-char branch) and its tests in `failover-matches.test.ts`. Note: on the current PR branch `isBillingErrorMessage` is `true` for this body, so `formatAssistantErrorText` returns the billing copy (not the raw `LLM error …` string) and the passthrough exception never sees it — which is exactly why the billing-lane entry MUST be removed for Approach C to work. On a clean `boon` branch there is nothing to remove. Either way the end state is: this error is **unclassified** for failover, `failover-matches.ts` carries no `allocation_exhausted` pattern, and `formatAssistantErrorText` reaches the raw path.

## Testing

1. `formatAssistantErrorText` — gateway body returns exactly `LLM error allocation_exhausted: Token allocation exhausted. Contact sales to upgrade your plan.` (confirms the raw path is reached, i.e. not billing-classified).
2. `formatUserFacingAssistantErrorText` (end-to-end incl. passthrough net) — same body returns the same string, i.e. **not** swallowed to `"LLM request failed."`. This is the core regression guard.
3. `isRawAssistantErrorPassthrough` unit — returns `false` for `{friendlyError: "LLM error allocation_exhausted: …", rawError: <body>}`.
4. Failover classification — `classifyFailoverReason(body)` is `null` and `isBillingErrorMessage(body)` is `false` (proves no billing lane).
5. Negative / over-match guards — a different code like `{"error":"resource_exhausted",...}` is still treated as a passthrough (the exception does not fire), and other raw `LLM error …` payloads remain suppressed (safety net otherwise intact).

## Risks

- **Weakening the safety net**: the exception must be keyed strictly to `type === "allocation_exhausted"`, not a broad match, so no other raw payload slips through. Covered by test #5.
- **Billing-lane interference**: if PR #43's classification is present, `formatAssistantErrorText` returns billing copy before the raw path, so the passthrough exception is moot. Mitigated by the branch-baseline requirement (fresh `boon`, or remove the billing-lane entry). Covered by test #1 and #4.
- **Payload shape drift**: relies on `parseApiErrorInfo` reading the flat `{"error":"...","message":"..."}` shape, which it already supports (`assistant-error-format.ts:191-196`). Covered by tests #1/#2.
