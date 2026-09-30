import { i as ReplyThreadingPolicy } from "./types-DLZ49gm8.js";
import { T as ReplyToMode } from "./types.base-D59Q9aQB.js";
import { n as isSingleUseReplyToMode, t as createReplyReferencePlanner } from "./reply-reference-M_PIpHDf.js";

//#region src/auto-reply/reply/reply-threading.d.ts
/** Build threading policy for batched reply-to mode. */
declare function resolveBatchedReplyThreadingPolicy(mode: ReplyToMode, isBatched: boolean): ReplyThreadingPolicy | undefined;
//#endregion
export { type ReplyThreadingPolicy, createReplyReferencePlanner, isSingleUseReplyToMode, resolveBatchedReplyThreadingPolicy };