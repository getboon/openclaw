import { normalizeOptionalString } from "@openclaw/normalization-core/string-coerce";
import { copyReplyPayloadMetadata } from "../reply-payload.js";
import type { AgentDecisionTrace, ReplyPayload } from "../reply-payload.js";

type ToolSummary = {
  calls: number;
  tools: string[];
  failures?: number;
  visibleTools?: string[];
  invocations?: Array<{
    name: string;
    status: "ok" | "error" | "blocked";
  }>;
};

const MAX_TRACE_TOOL_NAME_CHARS = 120;
// must stay <= boon-core AUDIT_TRACE_MAX_ITEMS
const MAX_TRACE_ITEMS = 128;
const TRACE_TOOL_NAME_RE = /^[A-Za-z0-9_:.-]+$/;

function normalizeTraceToolName(value: unknown): string | undefined {
  const name = normalizeOptionalString(value);
  if (
    !name ||
    name !== value ||
    name.length > MAX_TRACE_TOOL_NAME_CHARS ||
    !TRACE_TOOL_NAME_RE.test(name)
  ) {
    return undefined;
  }
  return name;
}

function normalizeTraceToolStatus(value: unknown): "ok" | "error" | "blocked" | undefined {
  return value === "ok" || value === "error" || value === "blocked" ? value : undefined;
}

function normalizeNames(values: readonly string[] | undefined): string[] {
  return [
    ...new Set(
      (values ?? []).flatMap((value) => {
        const name = normalizeTraceToolName(value);
        return name ? [name] : [];
      }),
    ),
  ]
    .toSorted()
    .slice(0, MAX_TRACE_ITEMS);
}

/** Projects runtime-owned facts into the portable, chain-of-thought-free audit contract. */
export function buildAgentDecisionTrace(params: {
  toolSummary?: ToolSummary;
  completion?: { refusal?: boolean };
  error?: unknown;
  failureSignal?: { kind?: string; code?: string };
}): AgentDecisionTrace {
  const visibleTools = normalizeNames(params.toolSummary?.visibleTools);
  // Normalize the FULL invocation set first and derive the disposition from it,
  // so a failure/blocked call beyond MAX_TRACE_ITEMS still drives the outcome.
  // Only the emitted `toolInvocations`/`evidence` arrays are bounded (wire size);
  // truncating before counting would let a late failure read as a clean success.
  const allInvocations =
    params.toolSummary?.invocations?.flatMap((invocation) => {
      const name = normalizeTraceToolName(invocation.name);
      const status = normalizeTraceToolStatus(invocation.status);
      return name && status ? [{ name, status }] : [];
    }) ?? [];
  const toolInvocations = allInvocations.slice(0, MAX_TRACE_ITEMS);
  const successfulCalls = allInvocations.filter((entry) => entry.status === "ok").length;
  const failedCalls = allInvocations.filter((entry) => entry.status === "error").length;
  const blockedCalls = allInvocations.filter((entry) => entry.status === "blocked").length;
  const permissionRequired =
    params.failureSignal?.kind === "execution_denied" ||
    params.failureSignal?.code === "SYSTEM_RUN_DENIED";

  let decision: Pick<AgentDecisionTrace, "confidence" | "disposition" | "reason">;
  if (permissionRequired) {
    decision = {
      confidence: "high",
      disposition: "permission_required",
      reason: "permission_required",
    };
  } else if (params.completion?.refusal === true) {
    decision = {
      confidence: "high",
      disposition: "refused",
      reason: "provider_reported_refusal",
    };
  } else if (params.error) {
    decision = { confidence: "high", disposition: "failed", reason: "run_failed" };
  } else if (failedCalls + blockedCalls > 0 && successfulCalls === 0) {
    decision = {
      confidence: "high",
      disposition: "failed",
      reason: blockedCalls > 0 ? "tool_execution_blocked" : "tool_execution_failed",
    };
  } else if (failedCalls + blockedCalls > 0) {
    decision = {
      confidence: "medium",
      disposition: "completed",
      reason: "tool_execution_partial",
    };
  } else if (successfulCalls > 0) {
    decision = {
      confidence: "high",
      disposition: "completed",
      reason: "tool_execution_succeeded",
    };
  } else if (visibleTools.length > 0) {
    decision = {
      confidence: "low",
      disposition: "unverified",
      reason: "no_tool_invocation",
    };
  } else {
    decision = {
      confidence: "medium",
      disposition: "completed",
      reason: "no_tools_visible",
    };
  }

  return {
    schemaVersion: 1,
    visibleTools,
    toolInvocations,
    evidence: toolInvocations.map((invocation) => ({
      kind: "tool_outcome",
      tool: invocation.name,
      status: invocation.status,
    })),
    ...decision,
  };
}

/** Attaches audit facts to one terminal assistant payload without decorating notices. */
export function attachAgentDecisionTrace(
  payloads: readonly ReplyPayload[],
  auditTrace: AgentDecisionTrace,
): ReplyPayload[] {
  const targetIndex = payloads.findLastIndex(
    (payload) =>
      payload.isReasoning !== true &&
      // `boon` has no `isCommentary` payload concept (present on upstream `main`).
      // Preserve #80's exclusion via a widening read so it self-heals if added.
      (payload as { isCommentary?: boolean }).isCommentary !== true &&
      payload.isStatusNotice !== true,
  );
  if (targetIndex < 0) {
    return [...payloads];
  }
  return payloads.map((payload, index) =>
    // Cloning the payload drops its WeakMap-backed delivery metadata
    // (threading/transcript/block-streaming identity); copy it onto the clone
    // so a traced terminal reply keeps its routing identity.
    index === targetIndex
      ? copyReplyPayloadMetadata(payload, { ...payload, auditTrace })
      : payload,
  );
}
