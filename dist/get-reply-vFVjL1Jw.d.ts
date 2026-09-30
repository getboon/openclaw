import { i as OpenClawConfig } from "./types.openclaw-C5-5RYY-.js";
import { f as ReplyPayload, n as GetReplyOptions } from "./types-BoVE295B.js";
import { o as MsgContext } from "./templating-a8lZ_mwE.js";

//#region src/auto-reply/reply/get-reply.d.ts
declare function getReplyFromConfig(ctx: MsgContext, opts?: GetReplyOptions, configOverride?: OpenClawConfig): Promise<ReplyPayload | ReplyPayload[] | undefined>;
//#endregion
export { getReplyFromConfig as t };