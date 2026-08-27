/**
 * sessions_history built-in tool.
 *
 * Reads bounded, redacted session transcript history after session visibility filtering.
 */
import { readStringValue } from "@openclaw/normalization-core/string-coerce";
import { Type } from "typebox";
import { getRuntimeConfig } from "../../config/config.js";
import type { OpenClawConfig } from "../../config/types.openclaw.js";
import { callGateway } from "../../gateway/call.js";
import { capArrayByJsonBytes } from "../../gateway/session-transcript-readers.js";
import { jsonUtf8Bytes } from "../../infra/json-utf8-bytes.js";
import { redactToolPayloadText } from "../../logging/redact.js";
import { truncateUtf16Safe } from "../../utils.js";
import { optionalPositiveIntegerSchema } from "../schema/typebox.js";
import {
  describeSessionsHistoryTool,
  SESSIONS_HISTORY_TOOL_DISPLAY_SUMMARY,
} from "../tool-description-presets.js";
import { dropToolPlumbingOnlyAssistantMessages, stripToolMessages } from "./chat-history-text.js";
import type { AnyAgentTool } from "./common.js";
import { jsonResult, readPositiveIntegerParam, readStringParam } from "./common.js";
import {
  createSessionVisibilityGuard,
  createAgentToAgentPolicy,
  resolveSessionReference,
  resolveSandboxedSessionToolContext,
  resolveSessionVisibilityContext,
  resolveVisibleSessionReference,
} from "./sessions-helpers.js";

const SessionsHistoryToolSchema = Type.Object({
  sessionKey: Type.String(),
  limit: optionalPositiveIntegerSchema(),
  includeTools: Type.Optional(Type.Boolean()),
});

const SESSIONS_HISTORY_MAX_BYTES = 80 * 1024;
const SESSIONS_HISTORY_TEXT_MAX_CHARS = 4000;
// Mirrors chat.history's own default (src/gateway/server-methods/chat.ts) so
// this tool always sends an explicit raw limit — needed to detect when that
// raw window undercounts logical turns (see the grow step below).
const SESSIONS_HISTORY_DEFAULT_LIMIT = 200;
// Mirrors chat.history's own hard cap (chat.ts's hardMax): it clamps
// internally to this regardless of what we ask, so a caller-requested limit
// above it can never be satisfied and a grown request never needs to ask
// for more than this either.
const SESSIONS_HISTORY_GATEWAY_HARD_CAP = 1000;
type GatewayCaller = typeof callGateway;

// sandbox policy handling is shared with sessions-list-tool via sessions-helpers.ts

function truncateHistoryText(text: string): {
  text: string;
  truncated: boolean;
  redacted: boolean;
} {
  // sessions_history is a tool surface, not a log sink. Keep it redacted even
  // when operators disable general-purpose log redaction.
  const sanitized = redactToolPayloadText(text);
  const redacted = sanitized !== text;
  if (sanitized.length <= SESSIONS_HISTORY_TEXT_MAX_CHARS) {
    return { text: sanitized, truncated: false, redacted };
  }
  const cut = truncateUtf16Safe(sanitized, SESSIONS_HISTORY_TEXT_MAX_CHARS);
  return { text: `${cut}\n…(truncated)…`, truncated: true, redacted };
}

function sanitizeHistoryContentBlock(block: unknown): {
  block: unknown;
  truncated: boolean;
  redacted: boolean;
} {
  if (!block || typeof block !== "object") {
    return { block, truncated: false, redacted: false };
  }
  const entry = { ...(block as Record<string, unknown>) };
  let truncated = false;
  let redacted = false;
  const type = typeof entry.type === "string" ? entry.type : "";
  if (typeof entry.text === "string") {
    const res = truncateHistoryText(entry.text);
    entry.text = res.text;
    truncated ||= res.truncated;
    redacted ||= res.redacted;
  }
  if (type === "thinking") {
    if (typeof entry.thinking === "string") {
      const res = truncateHistoryText(entry.thinking);
      entry.thinking = res.text;
      truncated ||= res.truncated;
      redacted ||= res.redacted;
    }
    // The encrypted signature can be extremely large and is not useful for history recall.
    if ("thinkingSignature" in entry) {
      delete entry.thinkingSignature;
      truncated = true;
    }
    if ("openclawReasoningReplay" in entry) {
      delete entry.openclawReasoningReplay;
      truncated = true;
    }
  }
  if (typeof entry.partialJson === "string") {
    const res = truncateHistoryText(entry.partialJson);
    entry.partialJson = res.text;
    truncated ||= res.truncated;
    redacted ||= res.redacted;
  }
  if (type === "image") {
    const data = readStringValue(entry.data);
    const bytes = data ? data.length : undefined;
    if ("data" in entry) {
      delete entry.data;
      truncated = true;
    }
    entry.omitted = true;
    if (bytes !== undefined) {
      entry.bytes = bytes;
    }
  }
  return { block: entry, truncated, redacted };
}

function sanitizeHistoryMessage(message: unknown): {
  message: unknown;
  truncated: boolean;
  redacted: boolean;
} {
  if (!message || typeof message !== "object") {
    return { message, truncated: false, redacted: false };
  }
  const entry = { ...(message as Record<string, unknown>) };
  let truncated = false;
  let redacted = false;
  // Tool result details often contain very large nested payloads.
  if ("details" in entry) {
    delete entry.details;
    truncated = true;
  }
  if ("usage" in entry) {
    delete entry.usage;
    truncated = true;
  }
  if ("cost" in entry) {
    delete entry.cost;
    truncated = true;
  }

  if (typeof entry.content === "string") {
    const res = truncateHistoryText(entry.content);
    entry.content = res.text;
    truncated ||= res.truncated;
    redacted ||= res.redacted;
  } else if (Array.isArray(entry.content)) {
    const updated = entry.content.map((block) => sanitizeHistoryContentBlock(block));
    entry.content = updated.map((item) => item.block);
    truncated ||= updated.some((item) => item.truncated);
    redacted ||= updated.some((item) => item.redacted);
  }
  if (typeof entry.text === "string") {
    const res = truncateHistoryText(entry.text);
    entry.text = res.text;
    truncated ||= res.truncated;
    redacted ||= res.redacted;
  }
  return { message: entry, truncated, redacted };
}

function enforceSessionsHistoryHardCap(params: {
  items: unknown[];
  bytes: number;
  maxBytes: number;
}): { items: unknown[]; bytes: number; hardCapped: boolean } {
  if (params.bytes <= params.maxBytes) {
    return { items: params.items, bytes: params.bytes, hardCapped: false };
  }

  const last = params.items.at(-1);
  const lastOnly = last ? [last] : [];
  const lastBytes = jsonUtf8Bytes(lastOnly);
  if (lastBytes <= params.maxBytes) {
    return { items: lastOnly, bytes: lastBytes, hardCapped: true };
  }

  const placeholder = [
    {
      role: "assistant",
      content: "[sessions_history omitted: message too large]",
    },
  ];
  return { items: placeholder, bytes: jsonUtf8Bytes(placeholder), hardCapped: true };
}

function selectLogicalHistoryMessages(rawMessages: unknown[], includeTools: boolean): unknown[] {
  if (includeTools) {
    return rawMessages;
  }
  return dropToolPlumbingOnlyAssistantMessages(stripToolMessages(rawMessages));
}

type RawHistoryWindow = { messages: unknown[]; hasMoreBeforeWindow: boolean };

/**
 * Fetches up to `rawLimit` raw transcript entries, over-reading by one so an
 * exact-limit response can be told apart from a response that was capped
 * with more history still before it — chat.history exposes no separate
 * has-more signal, so this mirrors the +1 overread it already uses
 * internally (readRecentSessionMessagesAsync's maxMessages+1) to make the
 * same distinction. When rawLimit is already at the gateway's own hard cap
 * there is no room to overread, so a full window is treated as "maybe more"
 * since it genuinely can't be disproven.
 */
async function fetchRawHistoryWindow(params: {
  gatewayCall: GatewayCaller;
  resolvedKey: string;
  rawLimit: number;
}): Promise<RawHistoryWindow> {
  const overreadLimit = Math.min(params.rawLimit + 1, SESSIONS_HISTORY_GATEWAY_HARD_CAP);
  const result = await params.gatewayCall<{ messages: Array<unknown> }>({
    method: "chat.history",
    params: { sessionKey: params.resolvedKey, limit: overreadLimit },
  });
  const fetched = Array.isArray(result?.messages) ? result.messages : [];
  const canDetectOverread = overreadLimit > params.rawLimit;
  const hasMoreBeforeWindow = canDetectOverread
    ? fetched.length > params.rawLimit
    : fetched.length >= params.rawLimit;
  const messages = fetched.length > params.rawLimit ? fetched.slice(-params.rawLimit) : fetched;
  return { messages, hasMoreBeforeWindow };
}

export function createSessionsHistoryTool(opts?: {
  agentSessionKey?: string;
  sandboxed?: boolean;
  config?: OpenClawConfig;
  callGateway?: GatewayCaller;
}): AnyAgentTool {
  return {
    label: "Session History",
    name: "sessions_history",
    displaySummary: SESSIONS_HISTORY_TOOL_DISPLAY_SUMMARY,
    description: describeSessionsHistoryTool(),
    parameters: SessionsHistoryToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const gatewayCall = opts?.callGateway ?? callGateway;
      const sessionKeyParam = readStringParam(params, "sessionKey", {
        required: true,
      });
      const cfg = opts?.config ?? getRuntimeConfig();
      const { mainKey, alias, effectiveRequesterKey, restrictToSpawned } =
        resolveSandboxedSessionToolContext({
          cfg,
          agentSessionKey: opts?.agentSessionKey,
          sandboxed: opts?.sandboxed,
        });
      const resolvedSession = await resolveSessionReference({
        sessionKey: sessionKeyParam,
        alias,
        mainKey,
        requesterInternalKey: effectiveRequesterKey,
        restrictToSpawned,
      });
      if (!resolvedSession.ok) {
        return jsonResult({ status: resolvedSession.status, error: resolvedSession.error });
      }
      const visibleSession = await resolveVisibleSessionReference({
        resolvedSession,
        requesterSessionKey: effectiveRequesterKey,
        restrictToSpawned,
        visibilitySessionKey: sessionKeyParam,
      });
      if (!visibleSession.ok) {
        return jsonResult({
          status: visibleSession.status,
          error: visibleSession.error,
        });
      }
      // From here on, use the canonical key (sessionId inputs already resolved).
      const resolvedKey = visibleSession.key;
      const displayKey = visibleSession.displayKey;

      const a2aPolicy = createAgentToAgentPolicy(cfg);
      const { visibility, clampedFromSandbox } = resolveSessionVisibilityContext({
        cfg,
        sandboxed: opts?.sandboxed === true,
      });
      const visibilityGuard = await createSessionVisibilityGuard({
        action: "history",
        requesterSessionKey: effectiveRequesterKey,
        visibility,
        a2aPolicy,
        clampedFromSandbox,
      });
      const access = visibilityGuard.check(resolvedKey);
      if (!access.allowed) {
        return jsonResult({
          status: access.status,
          error: access.error,
        });
      }

      const limit = readPositiveIntegerParam(params, "limit");
      const includeTools = Boolean(params.includeTools);
      const requestedLimit = limit ?? SESSIONS_HISTORY_DEFAULT_LIMIT;
      const desiredLimit = Math.min(requestedLimit, SESSIONS_HISTORY_GATEWAY_HARD_CAP);
      // A caller-requested limit above the gateway's hard cap can never be
      // fully satisfied — that alone means this read is truncated, regardless
      // of what the raw fetch below reports.
      const requestExceededGatewayCap = requestedLimit > desiredLimit;

      let rawLimit = desiredLimit;
      let { messages: rawMessages, hasMoreBeforeWindow } = await fetchRawHistoryWindow({
        gatewayCall,
        resolvedKey,
        rawLimit,
      });
      let logicalMessages = selectLogicalHistoryMessages(rawMessages, includeTools);

      // chat.history's `limit` bounds raw transcript entries — delivery-mirror
      // duplicates and tool-call/thinking-only stubs count against it just
      // like real turns — so a caller asking for N logical turns can get a
      // window that is mostly noise. When the raw window was fully consumed
      // and still came up short, widen it once using the noise ratio
      // actually observed in this sample rather than guessing a fixed
      // multiplier.
      if (!includeTools && hasMoreBeforeWindow && logicalMessages.length < desiredLimit) {
        const observedNoiseRatio = rawMessages.length / Math.max(logicalMessages.length, 1);
        const grownLimit = Math.min(
          SESSIONS_HISTORY_GATEWAY_HARD_CAP,
          Math.ceil(desiredLimit * Math.max(observedNoiseRatio, 2)),
        );
        if (grownLimit > rawLimit) {
          rawLimit = grownLimit;
          ({ messages: rawMessages, hasMoreBeforeWindow } = await fetchRawHistoryWindow({
            gatewayCall,
            resolvedKey,
            rawLimit,
          }));
          logicalMessages = selectLogicalHistoryMessages(rawMessages, includeTools);
        }
      }

      // More real history may still exist before this window: the raw fetch
      // was capped with more before it, growth returned more logical turns
      // than asked for and the tail trim below drops the rest, or the
      // caller's own request exceeded what the gateway can ever return.
      const moreHistoryAvailable =
        hasMoreBeforeWindow || logicalMessages.length > desiredLimit || requestExceededGatewayCap;
      const selectedMessages =
        logicalMessages.length > desiredLimit
          ? logicalMessages.slice(logicalMessages.length - desiredLimit)
          : logicalMessages;

      const sanitizedMessages = selectedMessages.map((message) => sanitizeHistoryMessage(message));
      const contentTruncated = sanitizedMessages.some((entry) => entry.truncated);
      const contentRedacted = sanitizedMessages.some((entry) => entry.redacted);
      const cappedMessages = capArrayByJsonBytes(
        sanitizedMessages.map((entry) => entry.message),
        SESSIONS_HISTORY_MAX_BYTES,
      );
      const byteCapped = cappedMessages.items.length < selectedMessages.length;
      const hardened = enforceSessionsHistoryHardCap({
        items: cappedMessages.items,
        bytes: cappedMessages.bytes,
        maxBytes: SESSIONS_HISTORY_MAX_BYTES,
      });
      const droppedMessages = byteCapped || hardened.hardCapped || moreHistoryAvailable;
      return jsonResult({
        sessionKey: displayKey,
        messages: hardened.items,
        truncated: droppedMessages || contentTruncated,
        droppedMessages,
        contentTruncated,
        contentRedacted,
        bytes: hardened.bytes,
      });
    },
  };
}
