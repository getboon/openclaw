import { u as ChannelDirectoryEntry } from "./types.core-9OlsJj7i.js";
import { t as DirectoryConfigParams } from "./directory-types-BeaC_R7j.js";
//#region extensions/discord/src/directory-config.d.ts
declare const listDiscordDirectoryPeersFromConfig: (configParams: DirectoryConfigParams) => Promise<ChannelDirectoryEntry[]>;
declare const listDiscordDirectoryGroupsFromConfig: (configParams: DirectoryConfigParams) => Promise<ChannelDirectoryEntry[]>;
//#endregion
export { listDiscordDirectoryPeersFromConfig as n, listDiscordDirectoryGroupsFromConfig as t };