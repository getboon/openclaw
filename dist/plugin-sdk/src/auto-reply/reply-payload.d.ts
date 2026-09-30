import type { ToolFailureDigest } from "../agents/tool-failure-digest.js";
import { type GatewayFailureCode, type RetryAffordance } from "../channels/message/message-origin.js";
/** Reply payload contracts and metadata helpers shared by dispatch and channel renderers. */
import type { ReplyToMode } from "../config/types.base.js";
import type { InteractiveReply, MessagePresentation, ReplyPayloadDelivery } from "../interactive/payload.js";
export type AgentDecisionTraceToolStatus = "ok" | "partial" | "error" | "blocked";
/** Bounded, user-visible execution facts. Never contains model reasoning or tool data. */
export type AgentDecisionTrace = {
    schemaVersion: 1;
    visibleTools: string[];
    toolInvocations: Array<{
        name: string;
        status: AgentDecisionTraceToolStatus;
        /**
         * Real error text for a `status:"blocked"` entry from any thrown
         * pre-execution failure — the before_tool_call handler or surrounding
         * pipeline (trusted policy / approval / skill-workshop); absent for a plain
         * veto and for ok/error entries. Additive — old consumers ignore it.
         */
        detail?: string;
    }>;
    evidence: Array<{
        kind: "tool_outcome";
        tool: string;
        status: AgentDecisionTraceToolStatus;
        /** See toolInvocations[].detail — same pre-execution failure error text. */
        detail?: string;
    }>;
    confidence: "high" | "medium" | "low";
    disposition: "completed" | "permission_required" | "refused" | "failed" | "unverified";
    reason: "tool_execution_succeeded" | "tool_execution_partial" | "tool_execution_failed" | "tool_execution_blocked" | "no_tool_invocation" | "no_tools_visible" | "permission_required" | "provider_reported_refusal" | "run_failed";
};
/** Channel-agnostic assistant reply payload. */
export type ReplyPayload = {
    text?: string;
    mediaUrl?: string;
    mediaUrls?: string[];
    /** Internal-only trust signal for gateway webchat local media embedding. */
    trustedLocalMedia?: boolean;
    /** Treat media as live-only content and avoid persisting the underlying media reference. */
    sensitiveMedia?: boolean;
    /** Channel-agnostic rich presentation. Core degrades or asks the channel renderer to map it. */
    presentation?: MessagePresentation;
    /** Channel-agnostic delivery preferences, e.g. pin the sent message when supported. */
    delivery?: ReplyPayloadDelivery;
    /**
     * @deprecated Use presentation.
     *
     * Internal legacy representation used by existing approval/reply helpers during migration.
     */
    interactive?: InteractiveReply;
    btw?: {
        question: string;
    };
    replyToId?: string;
    /** Internal reply-policy provenance; implicit ids honor single-use reply modes. */
    replyToIdSource?: "explicit" | "implicit";
    replyToTag?: boolean;
    /** True when [[reply_to_current]] was present but not yet mapped to a message id. */
    replyToCurrent?: boolean;
    /** Send audio as voice message (bubble) instead of audio file. Defaults to false. */
    audioAsVoice?: boolean;
    /**
     * Text synthesized into an audio-only TTS payload. Exposed to hooks for
     * archival/search use when no visible channel text is sent.
     */
    spokenText?: string;
    /**
     * Marks a TTS media payload as supplemental audio for assistant text that is
     * already visible through streaming or transcript projection.
     */
    ttsSupplement?: ReplyPayloadTtsSupplement;
    isError?: boolean;
    /** Marks this payload as a reasoning/thinking block. Channels that do not
     *  have a dedicated reasoning lane (e.g. WhatsApp, web) should suppress it. */
    isReasoning?: boolean;
    /** Reasoning stream text is a complete replacement snapshot, not a delta. */
    isReasoningSnapshot?: boolean;
    /** Marks this payload as a compaction status notice (start/end).
     *  Should be excluded from TTS transcript accumulation so compaction
     *  status lines are not synthesised into the spoken assistant reply. */
    isCompactionNotice?: boolean;
    /** Marks this payload as transient status, not assistant answer content. */
    isStatusNotice?: boolean;
    /** Portable audit facts for clients that render or inspect agent execution. */
    auditTrace?: AgentDecisionTrace;
    /** Channel-specific payload data (per-channel envelope). */
    channelData?: Record<string, unknown>;
};
/** Metadata for fast-auto progress notices. */
export declare const FAST_MODE_AUTO_PROGRESS_KIND = "fast-mode-auto";
export declare function isFastModeAutoProgressPayload(payload: Pick<ReplyPayload, "channelData">): boolean;
/** Metadata for audio-only media that supplements already-visible assistant text. */
export type ReplyPayloadTtsSupplement = {
    spokenText: string;
    visibleTextAlreadyDelivered?: boolean;
};
/** Reply policy facts that provider adapters use to resolve the final transport route. */
export type ReplyDeliveryContext = {
    chatType?: "direct" | "group" | "channel" | null;
    replyToMode: ReplyToMode;
};
/** Appends the standard media failure warning without duplicating it. */
export declare function appendReplyMediaFailureWarning(text: string | undefined): string;
/** Returns normalized TTS supplement metadata only when the payload has media to carry it. */
export declare function getReplyPayloadTtsSupplement(payload: Pick<ReplyPayload, "mediaUrl" | "mediaUrls" | "ttsSupplement">): ReplyPayloadTtsSupplement | undefined;
/** Returns true when the payload is a valid TTS supplement media payload. */
export declare function isReplyPayloadTtsSupplement(payload: Pick<ReplyPayload, "mediaUrl" | "mediaUrls" | "ttsSupplement">): boolean;
/** Marks a reply payload as supplemental TTS media while preserving the original shape. */
export declare function markReplyPayloadAsTtsSupplement<T extends ReplyPayload>(payload: T, spokenText?: string, options?: {
    visibleTextAlreadyDelivered?: boolean;
}): T;
/** Removes visible-only fields from a payload that should be delivered as TTS supplement media. */
export declare function buildTtsSupplementMediaPayload(payload: ReplyPayload): ReplyPayload;
/** WeakMap-backed metadata attached to payload objects without changing wire shape. */
export type ReplyPayloadMetadata = {
    assistantMessageIndex?: number;
    /** The runtime owns the transcript decision for this assistant payload. */
    assistantTranscriptOwned?: boolean;
    /** replyToId existed before reply threading could inject an implicit target. */
    replyToIdExplicit?: boolean;
    /** Canonical reply policy used by both message-tool dedupe and final delivery routing. */
    replyDelivery?: ReplyDeliveryContext;
    /** Route identity that produced replyDelivery, used to reject stale cross-route policy. */
    replyDeliverySource?: {
        channel: string;
        accountId?: string;
    };
    /**
     * Internal OpenClaw notices generated after a runtime/provider failure are
     * not assistant source replies. Dispatch may deliver them even when normal
     * assistant source replies are message-tool-only; sendPolicy deny still wins.
     */
    deliverDespiteSourceReplySuppression?: boolean;
    /**
     * A message-tool reply to the active internal UI source. The final payload is
     * still the live delivery vehicle; this mirror makes the reply durable for
     * chat.history and page reloads without turning the internal UI into an
     * outbound channel.
     */
    sourceReplyTranscriptMirror?: {
        sessionKey: string;
        agentId?: string;
        text?: string;
        mediaUrls?: string[];
        idempotencyKey?: string;
    };
    beforeAgentRunBlocked?: boolean;
    /** Warning synthesized from an observed tool error after the run produced assistant output. */
    nonTerminalToolErrorWarning?: boolean;
    /**
     * Every unrecovered failed step behind a `nonTerminalToolErrorWarning`,
     * classified into a closed, user-safe reason (never raw error text, which
     * may embed a shell command or file path). Lets a channel plugin compose
     * its own leak-safe notice instead of discarding the warning outright
     * (ENG-18812) — never a substitute for the plugin's own redaction policy.
     */
    toolFailureDigest?: ToolFailureDigest;
    /** Terminal run-failure class behind an isError final reply (already downgraded at terminal). */
    gatewayFailureCode?: GatewayFailureCode;
};
/** Adds internal metadata to a reply payload object. */
export declare function setReplyPayloadMetadata<T extends object>(payload: T, metadata: ReplyPayloadMetadata): T;
/** Reads internal metadata attached to a reply payload object. */
export declare function getReplyPayloadMetadata(payload: object): ReplyPayloadMetadata | undefined;
/** Returns true when a payload is the synthesized warning for a non-terminal tool error. */
export declare function isReplyPayloadNonTerminalToolErrorWarning(payload: object): boolean;
/** Reads the per-failure digest attached to a non-terminal tool-error warning payload, if any. */
export declare function getReplyPayloadToolFailureDigest(payload: object): ToolFailureDigest | undefined;
/**
 * Why a turn stopped, for a terminal run-failure reply: a closed code plus how the user can act.
 * Lets a channel render its own stop state without matching the copy text.
 */
export declare function getReplyPayloadGatewayFailure(payload: object): {
    code: GatewayFailureCode;
    retryAffordance: RetryAffordance;
} | undefined;
/** Copies internal payload metadata when cloning or transforming payload objects. */
export declare function copyReplyPayloadMetadata<T extends object>(source: object, payload: T): T;
/** Marks a notice payload as deliverable even when normal source replies are suppressed. */
export declare function markReplyPayloadForSourceSuppressionDelivery<T extends object>(payload: T): T;
export declare function markCommandReplyForDelivery(reply: ReplyPayload | ReplyPayload[] | undefined): ReplyPayload | ReplyPayload[] | undefined;
/** Returns true for internal status/notice payloads, not assistant answer content. */
export declare function isReplyPayloadStatusNotice(payload: Pick<ReplyPayload, "isCompactionNotice" | "isStatusNotice">): boolean;
