import { t as BaseProbeResult } from "./types.core-9OlsJj7i.js";
import { t as ChannelPlugin } from "./types.plugin-CpPPGIEZ.js";
//#region extensions/msteams/src/probe.d.ts
type ProbeMSTeamsResult = BaseProbeResult<string> & {
  appId?: string;
  graph?: {
    ok: boolean;
    error?: string;
    roles?: string[];
    scopes?: string[];
  };
  delegatedAuth?: {
    ok: boolean;
    error?: string;
    scopes?: string[];
    userPrincipalName?: string;
  };
  /**
   * Non-fatal configuration notices, e.g. missing sharePointSiteId. A bot has
   * no personal OneDrive (app-only tokens can't call /me/drive), so without
   * this config, file/document sends in group chats and channels resolve to
   * an explicit undeliverable notice instead of an attachment.
   */
  warnings?: string[];
};
//#endregion
//#region extensions/msteams/src/channel.d.ts
type ResolvedMSTeamsAccount = {
  accountId: string;
  enabled: boolean;
  configured: boolean;
};
declare const msteamsPlugin: ChannelPlugin<ResolvedMSTeamsAccount, ProbeMSTeamsResult>;
//#endregion
export { msteamsPlugin as t };