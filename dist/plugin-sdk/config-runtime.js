import { s as coerceSecretRef } from "../types.secrets-Dz8NpNuA.js";
import "../agent-scope-XIomFVd1.js";
import { c as resolveDefaultAgentId } from "../agent-scope-config-DrIvffiJ.js";
import { n as resolveConfiguredSecretInputWithFallback, r as resolveRequiredConfiguredSecretRefInputString, t as resolveConfiguredSecretInputString } from "../resolve-configured-secret-input-string-CxGV04N2.js";
import { a as loadConfig, d as readConfigFileSnapshotForWrite, i as getRuntimeConfig, n as clearConfigCache, x as writeConfigFile } from "../io-T6HZMVrs.js";
import { t as resolveAgentMaxConcurrent } from "../agent-limits-DGV0ALs8.js";
import { i as resolveActiveTalkProviderConfig } from "../talk-ChoYuFfE.js";
import { i as getRuntimeConfigSnapshot, s as getRuntimeConfigSourceSnapshot, t as clearRuntimeConfigSnapshot, v as setRuntimeConfigSnapshot } from "../runtime-snapshot-D93_HOsR.js";
import { r as replaceConfigFile, t as mutateConfigFile } from "../config-Dft2iRNk.js";
import { t as canonicalizeMainSessionAlias } from "../main-session-DWI7gPJU.js";
import { L as resolveGroupSessionKey, S as loadSessionStore$1, _ as updateLastRoute, g as saveSessionStore, m as recordSessionMetaFromInbound, nt as resolveSessionStoreEntry, v as updateSessionStore, x as clearSessionStoreCacheForTest } from "../store-Duo8PvDp.js";
import { d as resolveStorePath } from "../paths-DfUJ_nbS.js";
import { a as loadCronStore, c as resolveCronStorePath, d as saveCronStore } from "../store-D6pq9qRa.js";
import { c as resolveSessionResetPolicy, i as resolveThreadFlag, n as resolveChannelResetConfig, o as evaluateSessionFreshness, r as resolveSessionResetType } from "../reset-DJwZ5LIQ.js";
import { n as resolveSessionKey } from "../session-key-Dxt4-zUk.js";
import { i as resolveToolsBySender, n as resolveChannelGroupRequireMention, t as resolveChannelGroupPolicy } from "../group-policy-CZQvB5Vj.js";
import { a as warnMissingProviderGroupPolicyFallbackOnce, i as resolveOpenProviderRuntimeGroupPolicy, n as resolveAllowlistProviderRuntimeGroupPolicy, r as resolveDefaultGroupPolicy, t as GROUP_POLICY_BLOCKED_LABEL } from "../runtime-group-policy-BEjP88cf.js";
import { t as applyModelOverrideToSessionEntry } from "../model-overrides-Dajvsx8b.js";
import { n as filterSupplementalContextItems, t as evaluateSupplementalContextVisibility } from "../context-visibility-C5CaKMWO.js";
import { t as resolveChannelModelOverride } from "../model-overrides-C4HzojoF.js";
import { t as resolveMarkdownTableMode } from "../markdown-tables-DEvABOVM.js";
import { n as isDangerousNameMatchingEnabled, r as resolveDangerousNameMatchingEnabled } from "../dangerous-name-matching-Z6nhxFXz.js";
import { a as patchSessionEntry, c as upsertSessionEntry, n as getSessionEntry, o as readSessionUpdatedAt, r as listSessionEntries, s as updateSessionStoreEntry } from "../session-store-runtime-W5WogtI8.js";
import { n as resolveLivePluginConfigObject, r as resolvePluginConfigObject, t as requireRuntimeConfig } from "../plugin-config-runtime-Dq_6_b5X.js";
import { r as logConfigUpdated } from "../logging-B6gaJjMV.js";
import { d as updateConfig } from "../shared-BfcmUfT_.js";
import { n as resolveDefaultContextVisibility, t as resolveChannelContextVisibilityMode } from "../context-visibility-J_Lhn2al.js";
import { n as resolveNativeCommandsEnabled, r as resolveNativeSkillsEnabled, t as isNativeCommandsExplicitlyDisabled } from "../commands-D-crgFmo.js";
import { a as resolveTelegramCustomCommands, i as normalizeTelegramCommandName, t as TELEGRAM_COMMAND_NAME_PATTERN } from "../telegram-command-config-BlGkt4gX.js";
//#region src/plugin-sdk/config-runtime.ts
/**
* @deprecated Public SDK subpath has no bundled extension production imports.
* Prefer narrower config subpaths such as plugin-config-runtime,
* config-mutation, and runtime-config-snapshot.
*/
/**
* @deprecated Use getSessionEntry/listSessionEntries for reads and
* patchSessionEntry/upsertSessionEntry for writes. This whole-store helper is
* kept only during the transition before SQLite migration. Callers must
* migrate away from reading sessions.json directly.
*/
const loadSessionStore = loadSessionStore$1;
//#endregion
export { GROUP_POLICY_BLOCKED_LABEL, TELEGRAM_COMMAND_NAME_PATTERN, applyModelOverrideToSessionEntry, canonicalizeMainSessionAlias, clearConfigCache, clearRuntimeConfigSnapshot, clearSessionStoreCacheForTest, coerceSecretRef, evaluateSessionFreshness, evaluateSupplementalContextVisibility, filterSupplementalContextItems, getRuntimeConfig, getRuntimeConfigSnapshot, getRuntimeConfigSourceSnapshot, getSessionEntry, isDangerousNameMatchingEnabled, isNativeCommandsExplicitlyDisabled, listSessionEntries, loadConfig, loadCronStore, loadSessionStore, logConfigUpdated, mutateConfigFile, normalizeTelegramCommandName, patchSessionEntry, readConfigFileSnapshotForWrite, readSessionUpdatedAt, recordSessionMetaFromInbound, replaceConfigFile, requireRuntimeConfig, resolveActiveTalkProviderConfig, resolveAgentMaxConcurrent, resolveAllowlistProviderRuntimeGroupPolicy, resolveChannelContextVisibilityMode, resolveChannelGroupPolicy, resolveChannelGroupRequireMention, resolveChannelModelOverride, resolveChannelResetConfig, resolveConfiguredSecretInputString, resolveConfiguredSecretInputWithFallback, resolveCronStorePath, resolveDangerousNameMatchingEnabled, resolveDefaultAgentId, resolveDefaultContextVisibility, resolveDefaultGroupPolicy, resolveGroupSessionKey, resolveLivePluginConfigObject, resolveMarkdownTableMode, resolveNativeCommandsEnabled, resolveNativeSkillsEnabled, resolveOpenProviderRuntimeGroupPolicy, resolvePluginConfigObject, resolveRequiredConfiguredSecretRefInputString, resolveSessionKey, resolveSessionResetPolicy, resolveSessionResetType, resolveSessionStoreEntry, resolveStorePath, resolveTelegramCustomCommands, resolveThreadFlag, resolveToolsBySender, saveCronStore, saveSessionStore, setRuntimeConfigSnapshot, updateConfig, updateLastRoute, updateSessionStore, updateSessionStoreEntry, upsertSessionEntry, warnMissingProviderGroupPolicyFallbackOnce, writeConfigFile };
