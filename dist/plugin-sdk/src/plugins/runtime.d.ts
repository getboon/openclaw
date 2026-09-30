import type { PluginRegistry, PluginRegistryParams } from "./registry-types.js";
/**
 * True when a registry has been superseded: explicitly retired, or replaced
 * by a fresh same-cache-key generation even though it was never the direct
 * previousRegistry for that swap (see isSameContextReplacement). Callers that
 * gate a side effect on "is this registry still genuinely live" (e.g. the
 * production scheduleSessionTurn shouldCommit wiring in registry.ts) should
 * use this instead of the raw isPluginRegistryRetired flag.
 */
export declare function isPluginRegistrySuperseded(registry: PluginRegistry): boolean;
/**
 * Re-checks retirement for a registry that a caller just stopped protecting
 * (e.g. a pending async operation just settled). Mirrors the re-check every
 * pin-release function already does after uninstalling its own pin -- a
 * registry that was kept alive only by that protection may now be retirable.
 * Preserves scheduler jobs committed via recordPendingCommittedSchedulerJobId
 * during this registry's pending window; once the window has fully closed
 * (no other overlapping call still holds the pin), that bookkeeping is
 * dropped so a later, unrelated retirement can't keep protecting stale jobs
 * from a window that already ended. Returns a promise callers may await for
 * tests; production callers don't need to and shouldn't.
 */
export declare function retirePluginRegistryIfNowUnused(registry: PluginRegistry | null): Promise<void>;
/**
 * Returns the distinct live plugin registries in precedence order: the active
 * registry first, then the pinned http-route and channel surfaces. Uses the
 * raw pinned registries (not channel-presentation selection) so a pinned
 * registry stays visible to runtime dispatch even with zero channels. Shared
 * by the agent-event bridge and the global hook runner so both dispatch
 * surfaces agree on what "live" means.
 */
export declare function collectLivePluginRegistries(): PluginRegistry[];
export declare function recordImportedPluginId(pluginId: string): void;
export declare function setActivePluginRegistry(registry: PluginRegistry, cacheKey?: string, runtimeSubagentMode?: "default" | "explicit" | "gateway-bindable", workspaceDir?: string, hostServices?: PluginRegistryParams["hostServices"]): void;
export declare function getActivePluginRegistry(): PluginRegistry | null;
export declare function isPluginLoadedInActiveRegistry(pluginId: string): boolean;
export declare function getActivePluginRegistryWorkspaceDir(): string | undefined;
export declare function getActivePluginHostServices(): PluginRegistryParams["hostServices"];
export declare function clearActivePluginHostServices(): void;
export declare function requireActivePluginRegistry(): PluginRegistry;
export declare function pinActivePluginHttpRouteRegistry(registry: PluginRegistry): void;
export declare function releasePinnedPluginHttpRouteRegistry(registry?: PluginRegistry): void;
export declare function getActivePluginHttpRouteRegistry(): PluginRegistry | null;
export declare function getActivePluginHttpRouteRegistryVersion(): number;
export declare function requireActivePluginHttpRouteRegistry(): PluginRegistry;
export declare function resolveActivePluginHttpRouteRegistry(fallback: PluginRegistry): PluginRegistry;
export declare function pinActivePluginChannelRegistry(registry: PluginRegistry): void;
export declare function releasePinnedPluginChannelRegistry(registry?: PluginRegistry): void;
export declare function getActivePluginChannelRegistry(): PluginRegistry | null;
export declare function getActivePluginChannelRegistryVersion(): number;
export declare function getActivePluginGatewayCommandRegistry(): PluginRegistry | null;
export declare function requireActivePluginChannelRegistry(): PluginRegistry;
export declare function pinActivePluginSessionExtensionRegistry(registry: PluginRegistry): void;
export declare function releasePinnedPluginSessionExtensionRegistry(registry?: PluginRegistry): void;
export declare function getActivePluginSessionExtensionRegistry(): PluginRegistry | null;
export declare function getActivePluginRegistryKey(): string | null;
export declare function getActivePluginRuntimeSubagentMode(): "default" | "explicit" | "gateway-bindable";
export declare function getActivePluginRegistryVersion(): number;
/**
 * Returns plugin ids that were imported by plugin runtime or registry loading in
 * the current process.
 *
 * This is a process-level view, not a fresh import trace: cached registry reuse
 * still counts because the plugin code was loaded earlier in this process.
 * Explicit loader import tracking covers plugins that were imported but later
 * ended in an error state during registration.
 * Bundle-format plugins are excluded because they can be "loaded" from metadata
 * without importing any JS entrypoint.
 */
export declare function listImportedRuntimePluginIds(): string[];
export declare function resetPluginRuntimeStateForTest(): void;
