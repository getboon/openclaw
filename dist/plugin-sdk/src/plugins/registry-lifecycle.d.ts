/** Tracks active and retired plugin registries so stale runtime calls can be rejected. */
import type { PluginRegistry } from "./registry-types.js";
/** Marks a registry retired so late runtime calls can reject stale plugin state. */
export declare function markPluginRegistryRetired(registry: PluginRegistry | null | undefined): void;
/** Marks a registry active and clears any previous retired state. */
export declare function markPluginRegistryActive(registry: PluginRegistry | null | undefined): void;
/** True when a registry has been activated for runtime use. */
export declare function isPluginRegistryActivated(registry: PluginRegistry): boolean;
/** True when a registry has been retired by a newer active registry. */
export declare function isPluginRegistryRetired(registry: PluginRegistry): boolean;
export declare function beginPendingRegistryOperation(registry: PluginRegistry | null | undefined): () => void;
/** True when a registry has at least one in-flight async operation still pending. */
export declare function hasPendingRegistryOperation(registry: PluginRegistry): boolean;
export declare function recordPluginRegistryCacheKey(registry: PluginRegistry | null | undefined, cacheKey: string | null): void;
/** The cache key a registry was activated under, or null if none was recorded. */
export declare function getPluginRegistryCacheKey(registry: PluginRegistry): string | null;
/** True when a newer registry generation has taken over this registry's load cache key. */
export declare function isPluginRegistryCacheKeySuperseded(registry: PluginRegistry): boolean;
export declare function recordPendingCommittedSchedulerJobId(registry: PluginRegistry | null | undefined, pluginId: string, jobId: string): void;
/** Committed job ids recorded via recordPendingCommittedSchedulerJobId, keyed by pluginId. */
export declare function getPendingCommittedSchedulerJobIds(registry: PluginRegistry): ReadonlyMap<string, ReadonlySet<string>>;
/** Drops accumulated ids once their shared pending window has fully closed. */
export declare function clearPendingCommittedSchedulerJobIds(registry: PluginRegistry | null | undefined): void;
