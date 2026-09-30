import { n as normalizeAccountId } from "./account-id-5IgE9UKY.js";
import { i as getActivePluginChannelRegistryVersion } from "./runtime-CvQv-UWJ.js";
import { a as normalizeChannelId, i as listChannelPlugins } from "./registry-poy-ZIAe2.js";
import "./plugins-FrubW_TC.js";
import { t as resolveAccountEntry } from "./account-lookup-DjMZZ6go.js";
//#region src/config/markdown-tables.ts
function buildDefaultTableModes() {
	return new Map(listChannelPlugins().flatMap((plugin) => {
		const defaultMarkdownTableMode = plugin.messaging?.defaultMarkdownTableMode;
		return defaultMarkdownTableMode ? [[plugin.id, defaultMarkdownTableMode]] : [];
	}).toSorted(([left], [right]) => left.localeCompare(right)));
}
let cachedDefaultTableModes = null;
let cachedDefaultTableModesRegistryVersion = null;
function getDefaultTableModes() {
	const registryVersion = getActivePluginChannelRegistryVersion();
	if (!cachedDefaultTableModes || cachedDefaultTableModesRegistryVersion !== registryVersion) {
		cachedDefaultTableModes = buildDefaultTableModes();
		cachedDefaultTableModesRegistryVersion = registryVersion;
	}
	return cachedDefaultTableModes;
}
const isMarkdownTableMode = (value) => value === "off" || value === "bullets" || value === "code" || value === "block";
function resolveMarkdownModeFromSection(section, accountId) {
	if (!section) return;
	const normalizedAccountId = normalizeAccountId(accountId);
	const accounts = section.accounts;
	if (accounts && typeof accounts === "object") {
		const matchMode = resolveAccountEntry(accounts, normalizedAccountId)?.markdown?.tables;
		if (isMarkdownTableMode(matchMode)) return matchMode;
	}
	const sectionMode = section.markdown?.tables;
	return isMarkdownTableMode(sectionMode) ? sectionMode : void 0;
}
function resolveMarkdownTableMode(params) {
	const channel = normalizeChannelId(params.channel);
	const defaultMode = channel ? getDefaultTableModes().get(channel) ?? "code" : "code";
	let resolved = defaultMode;
	if (channel && params.cfg) {
		const channelsConfig = params.cfg.channels;
		const rootConfig = params.cfg;
		resolved = resolveMarkdownModeFromSection(channelsConfig?.[channel] ?? rootConfig[channel], params.accountId) ?? defaultMode;
	}
	return resolved === "block" && !params.supportsBlockTables ? "code" : resolved;
}
//#endregion
export { resolveMarkdownTableMode as t };
