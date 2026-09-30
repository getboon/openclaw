import type { ReplyPayload } from "../../auto-reply/reply-payload.js";
import type { OpenClawConfig } from "../../config/types.openclaw.js";
import type { OutboundMediaAccess } from "../../media/load-options.js";
import { type OutboundDeliveryResult, type OutboundDeliveryQueuePolicy, type OutboundSendDeps } from "./deliver.js";
import { type OutboundMessageGatewayOptionsInput } from "./message-gateway-options.js";
import type { OutboundMirror } from "./mirror.js";
export type MessageGatewayOptions = OutboundMessageGatewayOptionsInput;
type MessageSendParams = {
    to: string;
    content: string;
    /** Active agent id for per-agent outbound media root scoping. */
    agentId?: string;
    /** Originating session key used for requester-scoped outbound media policy. */
    requesterSessionKey?: string;
    /** Originating account id used for requester-scoped outbound media policy. */
    requesterAccountId?: string;
    /** Originating sender id used for sender-scoped outbound media policy. */
    requesterSenderId?: string;
    /** Originating sender display name for name-keyed sender policy matching. */
    requesterSenderName?: string;
    /** Originating sender username for username-keyed sender policy matching. */
    requesterSenderUsername?: string;
    /** Originating sender E.164 phone number for e164-keyed sender policy matching. */
    requesterSenderE164?: string;
    channel?: string;
    mediaUrl?: string;
    mediaUrls?: string[];
    buffer?: string;
    filename?: string;
    contentType?: string;
    asVoice?: boolean;
    gifPlayback?: boolean;
    forceDocument?: boolean;
    accountId?: string;
    replyToId?: string;
    threadId?: string | number;
    dryRun?: boolean;
    bestEffort?: boolean;
    queuePolicy?: OutboundDeliveryQueuePolicy;
    payloads?: ReplyPayload[];
    mediaAccess?: OutboundMediaAccess;
    deps?: OutboundSendDeps;
    cfg?: OpenClawConfig;
    gateway?: MessageGatewayOptions;
    idempotencyKey?: string;
    mirror?: OutboundMirror;
    abortSignal?: AbortSignal;
    silent?: boolean;
    parseMode?: "HTML";
};
export type MessageSendResult = {
    channel: string;
    to: string;
    via: "direct" | "gateway";
    mediaUrl: string | null;
    mediaUrls?: string[];
    result?: OutboundDeliveryResult | {
        messageId: string;
    };
    deliveryStatus?: "suppressed" | "failed";
    /**
     * Underlying send error message when `deliveryStatus` is `"failed"` —
     * present only for `bestEffort` sends, where the caller asked not to throw
     * but still needs a real failure to be tellable from a delivered message.
     * This result becomes a tool's `details` verbatim (see `jsonResult` in
     * `src/agents/tools/common.ts`), and `isToolResultError`
     * (`src/agents/tool-result-error.ts`) already treats a truthy `error` field
     * as a failed tool call — naming it `error` (not e.g. `deliveryError`) is
     * what makes a failed bestEffort send become a real `lastToolError` instead
     * of silently reading as success. Formatted to a plain string (not the raw
     * `Error`) because tool-result sanitization (`sanitizeToolResult` /
     * `redactStringsDeep` in `src/agents/embedded-agent-subscribe.tools.ts`)
     * walks objects via `Object.entries`, which never sees an `Error`
     * instance's non-enumerable `message`/`stack` and would otherwise reduce it
     * to `{}` before `extractToolErrorMessage` reads it.
     */
    error?: string;
    dryRun?: boolean;
};
type MessagePollParams = {
    to: string;
    question: string;
    options: string[];
    maxSelections?: number;
    durationSeconds?: number;
    durationHours?: number;
    channel?: string;
    accountId?: string;
    threadId?: string;
    silent?: boolean;
    isAnonymous?: boolean;
    dryRun?: boolean;
    cfg?: OpenClawConfig;
    gateway?: MessageGatewayOptions;
    idempotencyKey?: string;
};
export type MessagePollResult = {
    channel: string;
    to: string;
    question: string;
    options: string[];
    maxSelections: number;
    durationSeconds: number | null;
    durationHours: number | null;
    via: "gateway";
    result?: {
        messageId: string;
        toJid?: string;
        channelId?: string;
        conversationId?: string;
        pollId?: string;
    };
    dryRun?: boolean;
};
export declare function sendMessage(params: MessageSendParams): Promise<MessageSendResult>;
export declare function sendPoll(params: MessagePollParams): Promise<MessagePollResult>;
export {};
