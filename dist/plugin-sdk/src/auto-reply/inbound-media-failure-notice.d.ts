import type { OpenClawConfig } from "../config/types.js";
import type { InboundMediaFailure, MsgContext } from "./templating.js";
/** Builds the user-facing sentence for one or more dropped inbound attachments. */
export declare function buildInboundMediaFailureNotice(failures: readonly InboundMediaFailure[]): string;
/**
 * Sends a best-effort notice back to the originating deliverable chat naming
 * dropped attachments. Reads `ctx.MediaFailures` by default; pass `failures`
 * explicitly to report only a subset (e.g. a caller that already reported an
 * earlier batch and only wants to notify about ones added since).
 */
export declare function sendInboundMediaFailureNotice(params: {
    ctx: MsgContext;
    cfg: OpenClawConfig;
    failures?: readonly InboundMediaFailure[];
}): Promise<void>;
