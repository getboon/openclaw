import type { AgentDecisionTrace } from "../reply-payload.js";

const UNSUPPORTED_CLAIM_TEXT = "I don't have a tool result supporting that statement yet.";

const CREDIBILITY_CLAIM_RE =
  /\b(?:verified|measured|confirmed|checked directly|pulled straight from|not from memory|it's real|it is real|done)\b/i;
const MEASUREMENT_CLAIM_RE =
  /\b\d[\d,]*(?:\.\d+)?\s*(?:pages?|drawings?|sheets?|items?|lf|linear feet|sf|square feet)\b/i;
const READY_STATE_CLAIM_RE =
  /\b(?:pages?|drawings?|sheets?|takeoff|measurements?|processed set)\b[\s\S]{0,60}\b(?:ready|done|complete|processed|finished)\b/i;

function hasSuccessfulToolResult(auditTrace: AgentDecisionTrace | undefined): boolean {
  return auditTrace?.evidence.some((entry) => entry.status === "ok") === true;
}

function containsGroundingClaim(text: string): boolean {
  return (
    CREDIBILITY_CLAIM_RE.test(text) ||
    MEASUREMENT_CLAIM_RE.test(text) ||
    READY_STATE_CLAIM_RE.test(text)
  );
}

/**
 * Removes unsupported measured/verified claims at the final outbound boundary.
 * Audit evidence is intentionally the only allow-list: assistant prose and
 * user-provided assertions cannot establish grounding.
 */
export function sanitizeUngroundedClaims(params: {
  text?: string;
  auditTrace?: AgentDecisionTrace;
  isError?: boolean;
  isReasoning?: boolean;
  isCommentary?: boolean;
  isCompactionNotice?: boolean;
  isFallbackNotice?: boolean;
  isStatusNotice?: boolean;
}): string | undefined {
  const text = params.text;
  if (
    !text ||
    params.isError === true ||
    params.isReasoning === true ||
    params.isCommentary === true ||
    params.isCompactionNotice === true ||
    params.isFallbackNotice === true ||
    params.isStatusNotice === true ||
    hasSuccessfulToolResult(params.auditTrace) ||
    !containsGroundingClaim(text)
  ) {
    return text;
  }

  return UNSUPPORTED_CLAIM_TEXT;
}
