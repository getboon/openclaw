import { normalizeOptionalString } from "@openclaw/normalization-core/string-coerce";
import { hasReplyPayloadContent } from "../../interactive/payload.js";
import { truncateUtf16Safe } from "../../utils.js";
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
    detail?: string;
  }>;
  /**
   * Errored calls still unresolved when the turn ended — every failure the
   * runtime did not mark `retried` (fixed by a later identical call). `0` means
   * every error was recovered before the turn finished; `undefined` means the
   * producer does not track recovery, so keep the legacy disposition.
   */
  unrecoveredFailures?: number;
};

const MAX_TRACE_TOOL_NAME_CHARS = 120;
// Cap the pre-execution failure detail so this bounded, user-visible trace can't carry an
// unbounded error blob into the audit contract. Generous enough for
// a real error message; long stack dumps are truncated.
const MAX_TRACE_DETAIL_CHARS = 500;
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

/** Normalize + bound the pre-execution failure detail; undefined when empty. */
function normalizeTraceDetail(value: unknown): string | undefined {
  const detail = normalizeOptionalString(value);
  if (!detail) {
    return undefined;
  }
  // UTF-16-safe so the cap never splits a surrogate pair (emoji) into a
  // malformed final character in the durable trace.
  return truncateUtf16Safe(detail, MAX_TRACE_DETAIL_CHARS);
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

function isTraceablePayload(payload: ReplyPayload): boolean {
  return (
    payload.isReasoning !== true &&
    // `boon` has no `isCommentary` payload concept. Preserve the exclusion via
    // a widening read so it self-heals if the field is added upstream.
    (payload as { isCommentary?: boolean }).isCommentary !== true &&
    payload.isStatusNotice !== true
  );
}

function isUsableAnswerPayload(payload: ReplyPayload): boolean {
  return (
    isTraceablePayload(payload) &&
    payload.isError !== true &&
    hasReplyPayloadContent(payload, { trimText: true, hasChannelData: false })
  );
}

function hasTraceablePayloadContent(payload: ReplyPayload): boolean {
  return (
    isTraceablePayload(payload) &&
    hasReplyPayloadContent(payload, { trimText: true, hasChannelData: false })
  );
}

/** Projects runtime-owned facts into the portable, chain-of-thought-free audit contract. */
export function buildAgentDecisionTrace(params: {
  toolSummary?: ToolSummary;
  completion?: { refusal?: boolean };
  error?: unknown;
  failureSignal?: { kind?: string; code?: string };
  payloads?: readonly ReplyPayload[];
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
      if (!name || !status) {
        return [];
      }
      // Detail is only meaningful for a blocked (pre-execution-failure) entry; never
      // attach a stray detail to an ok/error entry.
      const detail = status === "blocked" ? normalizeTraceDetail(invocation.detail) : undefined;
      return [{ name, status, ...(detail ? { detail } : {}) }];
    }) ?? [];
  const toolInvocations = allInvocations.slice(0, MAX_TRACE_ITEMS);
  const successfulCalls = allInvocations.filter((entry) => entry.status === "ok").length;
  const failedCalls = allInvocations.filter((entry) => entry.status === "error").length;
  const blockedCalls = allInvocations.filter((entry) => entry.status === "blocked").length;
  const permissionRequired =
    params.failureSignal?.kind === "execution_denied" ||
    params.failureSignal?.code === "SYSTEM_RUN_DENIED";
  const terminalInvocation = allInvocations.at(-1);
  const hasSuccessfulTerminalMessage =
    terminalInvocation?.name === "message" && terminalInvocation.status === "ok";
  const hasUsableAnswer = params.payloads?.some(isUsableAnswerPayload) === true;
  // Only runtime-confirmed retries can promote errored calls to recovered.
  // Blocked calls never ran, so they always remain partial. Recovery also
  // requires durable terminal delivery evidence and a usable assistant answer.
  const recoveredEveryFailure =
    failedCalls > 0 &&
    blockedCalls === 0 &&
    params.toolSummary?.unrecoveredFailures === 0 &&
    hasSuccessfulTerminalMessage &&
    hasUsableAnswer;

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
  } else if (recoveredEveryFailure) {
    decision = {
      // Medium, not high: calls did error, they were just resolved before the
      // turn ended. `toolInvocations`/`evidence` still carry every error.
      confidence: "medium",
      disposition: "completed",
      reason: "tool_execution_succeeded",
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
    evidence: toolInvocations.map((invocation) => {
      const entry: AgentDecisionTrace["evidence"][number] = {
        kind: "tool_outcome",
        tool: invocation.name,
        status: invocation.status,
      };
      if ("detail" in invocation && invocation.detail) {
        entry.detail = invocation.detail;
      }
      return entry;
    }),
    ...decision,
  };
}

/** Attaches audit facts to one terminal assistant payload without decorating notices. */
export function attachAgentDecisionTrace(
  payloads: readonly ReplyPayload[],
  auditTrace: AgentDecisionTrace,
): ReplyPayload[] {
  // Prefer a real answer over a trailing warning. Fall back to the warning
  // when it is the turn's only traceable payload.
  const answerIndex = payloads.findLastIndex(isUsableAnswerPayload);
  const targetIndex =
    answerIndex >= 0 ? answerIndex : payloads.findLastIndex(hasTraceablePayloadContent);
  if (targetIndex < 0) {
    return [...payloads];
  }
  return payloads.map((payload, index) =>
    // Cloning the payload drops its WeakMap-backed delivery metadata
    // (threading/transcript/block-streaming identity); copy it onto the clone
    // so a traced terminal reply keeps its routing identity.
    index === targetIndex ? copyReplyPayloadMetadata(payload, { ...payload, auditTrace }) : payload,
  );
}
