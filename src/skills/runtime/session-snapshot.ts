// Session snapshot helpers capture and restore runtime skill state for sessions.
import crypto from "node:crypto";
import { stableStringify } from "../../agents/stable-stringify.js";
import { redactConfigObject } from "../../config/redact-snapshot.js";
import type { OpenClawConfig } from "../../config/types.openclaw.js";
import { matchesSkillFilter } from "../discovery/filter.js";
import { buildWorkspaceSkillSnapshot } from "../loading/workspace.js";
import { WORKSPACE_SKILLS_PROMPT_FORMAT_VERSION } from "../types.js";
import type { SkillEligibilityContext, SkillSnapshot } from "../types.js";
import { getSkillsSnapshotVersion, shouldRefreshSnapshotForVersion } from "./refresh-state.js";
import { ensureSkillsWatcher } from "./refresh.js";
import { hydrateRuntimeSkills } from "./snapshot-hydration.js";

type RuntimeSkillsSnapshot = Pick<SkillSnapshot, "commandSkills" | "resolvedSkills">;

const runtimeSkillsCache = new Map<string, RuntimeSkillsSnapshot>();
const RUNTIME_SKILLS_CACHE_MAX = 10;

/** Inputs that make runtime skill snapshots reusable within a process. */
export type ReusableSkillSnapshotParams = {
  workspaceDir: string;
  config: OpenClawConfig;
  agentId?: string;
  skillFilter?: string[];
  eligibility?: SkillEligibilityContext;
  existingSnapshot?: SkillSnapshot;
  snapshotVersion?: number;
  watch?: boolean;
  hydrateExisting?: boolean;
};

export type ReusableSkillSnapshotResult = {
  snapshot: SkillSnapshot;
  shouldRefresh: boolean;
  snapshotVersion: number;
};

export function resetResolvedSkillsCacheForTests(): void {
  runtimeSkillsCache.clear();
}

function fingerprintSkillSnapshotConfig(config: OpenClawConfig): string {
  return crypto
    .createHash("sha256")
    .update(stableStringify(redactConfigObject(config)))
    .digest("hex");
}

function cacheRuntimeSkills(cacheKey: string, snapshot: SkillSnapshot): SkillSnapshot {
  runtimeSkillsCache.set(cacheKey, {
    commandSkills: snapshot.commandSkills,
    resolvedSkills: snapshot.resolvedSkills,
  });
  if (runtimeSkillsCache.size > RUNTIME_SKILLS_CACHE_MAX) {
    const oldest = runtimeSkillsCache.keys().next().value;
    if (oldest !== undefined) {
      runtimeSkillsCache.delete(oldest);
    }
  }
  return snapshot;
}

export function resolveReusableWorkspaceSkillSnapshot(
  params: ReusableSkillSnapshotParams,
): ReusableSkillSnapshotResult {
  if (params.watch !== false) {
    ensureSkillsWatcher({ workspaceDir: params.workspaceDir, config: params.config });
  }
  const snapshotVersion = params.snapshotVersion ?? getSkillsSnapshotVersion(params.workspaceDir);
  const promptFormatChanged =
    params.existingSnapshot?.promptFormatVersion !== WORKSPACE_SKILLS_PROMPT_FORMAT_VERSION;
  const skillVersionChanged = shouldRefreshSnapshotForVersion(
    params.existingSnapshot?.version,
    snapshotVersion,
  );
  const shouldRefresh =
    promptFormatChanged ||
    skillVersionChanged ||
    !matchesSkillFilter(params.existingSnapshot?.skillFilter, params.skillFilter);
  const buildSnapshot = () => {
    return buildWorkspaceSkillSnapshot(params.workspaceDir, {
      config: params.config,
      agentId: params.agentId,
      skillFilter: params.skillFilter,
      eligibility: params.eligibility,
      snapshotVersion,
    });
  };

  const configFingerprint = fingerprintSkillSnapshotConfig(params.config);
  const snapshotCacheKey = JSON.stringify([
    params.workspaceDir,
    snapshotVersion,
    params.skillFilter,
    params.agentId,
    params.eligibility,
    configFingerprint,
  ]);

  const cachedRebuild = (): SkillSnapshot => {
    const cached = runtimeSkillsCache.get(snapshotCacheKey);
    if (cached) {
      return cached as SkillSnapshot;
    }
    return cacheRuntimeSkills(snapshotCacheKey, buildSnapshot());
  };

  const snapshot =
    !params.existingSnapshot || shouldRefresh
      ? cacheRuntimeSkills(snapshotCacheKey, buildSnapshot())
      : params.hydrateExisting === false
        ? params.existingSnapshot
        : hydrateRuntimeSkills(params.existingSnapshot, cachedRebuild);
  return { snapshot, shouldRefresh, snapshotVersion };
}
