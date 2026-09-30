import { r as matchesSkillFilter } from "./agent-filter-vKovqx_z.js";
import { t as stableStringify } from "./stable-stringify-BL8fDhrH.js";
import { t as buildWorkspaceSkillSnapshot } from "./workspace-BDvw0NSh.js";
import { n as redactConfigObject } from "./redact-snapshot-CekpMV41.js";
import { r as getSkillsSnapshotVersion, s as shouldRefreshSnapshotForVersion } from "./refresh-state-DHnXO3IV.js";
import { n as ensureSkillsWatcher } from "./refresh-DB-8Ho4z.js";
import crypto from "node:crypto";
//#region src/skills/runtime/snapshot-hydration.ts
function hydrateRuntimeSkills(snapshot, rebuild) {
	if (snapshot.resolvedSkills !== void 0 && snapshot.commandSkills !== void 0) return snapshot;
	const rebuilt = rebuild();
	return {
		...snapshot,
		...snapshot.resolvedSkills === void 0 ? { resolvedSkills: rebuilt.resolvedSkills } : {},
		...snapshot.commandSkills === void 0 ? { commandSkills: rebuilt.commandSkills } : {}
	};
}
//#endregion
//#region src/skills/runtime/session-snapshot.ts
const runtimeSkillsCache = /* @__PURE__ */ new Map();
const RUNTIME_SKILLS_CACHE_MAX = 10;
function resetResolvedSkillsCacheForTests() {
	runtimeSkillsCache.clear();
}
function fingerprintSkillSnapshotConfig(config) {
	return crypto.createHash("sha256").update(stableStringify(redactConfigObject(config))).digest("hex");
}
function cacheRuntimeSkills(cacheKey, snapshot) {
	runtimeSkillsCache.set(cacheKey, {
		commandSkills: snapshot.commandSkills,
		resolvedSkills: snapshot.resolvedSkills
	});
	if (runtimeSkillsCache.size > RUNTIME_SKILLS_CACHE_MAX) {
		const oldest = runtimeSkillsCache.keys().next().value;
		if (oldest !== void 0) runtimeSkillsCache.delete(oldest);
	}
	return snapshot;
}
function resolveReusableWorkspaceSkillSnapshot(params) {
	if (params.watch !== false) ensureSkillsWatcher({
		workspaceDir: params.workspaceDir,
		config: params.config
	});
	const snapshotVersion = params.snapshotVersion ?? getSkillsSnapshotVersion(params.workspaceDir);
	const promptFormatChanged = params.existingSnapshot?.promptFormatVersion !== 1;
	const skillVersionChanged = shouldRefreshSnapshotForVersion(params.existingSnapshot?.version, snapshotVersion);
	const shouldRefresh = promptFormatChanged || skillVersionChanged || !matchesSkillFilter(params.existingSnapshot?.skillFilter, params.skillFilter);
	const buildSnapshot = () => {
		return buildWorkspaceSkillSnapshot(params.workspaceDir, {
			config: params.config,
			agentId: params.agentId,
			skillFilter: params.skillFilter,
			eligibility: params.eligibility,
			snapshotVersion
		});
	};
	const configFingerprint = fingerprintSkillSnapshotConfig(params.config);
	const snapshotCacheKey = JSON.stringify([
		params.workspaceDir,
		snapshotVersion,
		params.skillFilter,
		params.agentId,
		params.eligibility,
		configFingerprint
	]);
	const cachedRebuild = () => {
		const cached = runtimeSkillsCache.get(snapshotCacheKey);
		if (cached) return cached;
		return cacheRuntimeSkills(snapshotCacheKey, buildSnapshot());
	};
	return {
		snapshot: !params.existingSnapshot || shouldRefresh ? cacheRuntimeSkills(snapshotCacheKey, buildSnapshot()) : params.hydrateExisting === false ? params.existingSnapshot : hydrateRuntimeSkills(params.existingSnapshot, cachedRebuild),
		shouldRefresh,
		snapshotVersion
	};
}
//#endregion
export { resolveReusableWorkspaceSkillSnapshot as n, resetResolvedSkillsCacheForTests as t };
