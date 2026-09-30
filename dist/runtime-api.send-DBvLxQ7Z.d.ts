import { i as OpenClawConfig } from "./types.openclaw-C5-5RYY-.js";
import { S as MarkdownTableMode } from "./types.base-CdtQfn4L.js";
import { t as OutboundMediaAccess } from "./load-options-CQixiFLj.js";
import { f as ChunkMode } from "./outbound.types-DboaPG_c.js";
import { t as RequestClient } from "./rest-dwVTYt1g.js";
import { d as DiscordComponentBuildResult, h as DiscordComponentMessageSpec } from "./components-C-KyGmqQ.js";
import { v as DiscordSendResult } from "./send.types-C93HXeX8.js";

//#region extensions/discord/src/send.components.d.ts
type DiscordComponentSendOpts = {
  cfg: OpenClawConfig;
  accountId?: string;
  token?: string;
  rest?: RequestClient;
  silent?: boolean;
  replyTo?: string;
  sessionKey?: string;
  agentId?: string;
  mediaUrl?: string;
  mediaAccess?: OutboundMediaAccess;
  mediaLocalRoots?: readonly string[];
  mediaReadFile?: (filePath: string) => Promise<Buffer>;
  filename?: string;
  textLimit?: number;
  maxLinesPerMessage?: number;
  tableMode?: MarkdownTableMode;
  chunkMode?: ChunkMode;
  suppressEmbeds?: boolean;
};
declare function registerBuiltDiscordComponentMessage(params: {
  buildResult: DiscordComponentBuildResult;
  messageId: string;
  ttlMs?: number;
}): void;
declare function sendDiscordComponentMessage(to: string, spec: DiscordComponentMessageSpec, opts: DiscordComponentSendOpts): Promise<DiscordSendResult>;
declare function editDiscordComponentMessage(to: string, messageId: string, spec: DiscordComponentMessageSpec, opts: DiscordComponentSendOpts): Promise<DiscordSendResult>;
//#endregion
export { registerBuiltDiscordComponentMessage as n, sendDiscordComponentMessage as r, editDiscordComponentMessage as t };