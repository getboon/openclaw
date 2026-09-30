import { i as OpenClawConfig } from "./types.openclaw-C5-5RYY-.js";
import { st as DiscordAccountConfig } from "./types.channels-CEm1WcpD.js";
import { t as DiscordCredentialStatus } from "./token-Ds0dW2fv.js";

//#region extensions/discord/src/account-inspect.d.ts
type InspectedDiscordAccount = {
  accountId: string;
  enabled: boolean;
  name?: string;
  token: string;
  tokenSource: "env" | "config" | "none";
  tokenStatus: DiscordCredentialStatus;
  configured: boolean;
  config: DiscordAccountConfig;
};
declare function inspectDiscordAccount(params: {
  cfg: OpenClawConfig;
  accountId?: string | null;
  envToken?: string | null;
}): InspectedDiscordAccount;
//#endregion
export { inspectDiscordAccount as n, InspectedDiscordAccount as t };