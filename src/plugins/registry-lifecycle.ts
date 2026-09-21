/** Tracks active and retired plugin registries so stale runtime calls can be rejected. */
import type { PluginRegistry } from "./registry-types.js";

const retiredRegistries = new WeakSet<PluginRegistry>();
const activatedRegistries = new WeakSet<PluginRegistry>();
const pendingAsyncOperationCounts = new WeakMap<PluginRegistry, number>();
const registryCacheKeys = new WeakMap<PluginRegistry, string | null>();
const supersededCacheKeyRegistries = new WeakSet<PluginRegistry>();
const latestCacheKeyRegistries = new Map<string, WeakRef<PluginRegistry>>();
const pendingCommittedSchedulerJobIds = new WeakMap<PluginRegistry, Map<string, Set<string>>>();

const cacheKeyRegistryFinalizer = new FinalizationRegistry<{
  cacheKey: string;
  ref: WeakRef<PluginRegistry>;
}>(({ cacheKey, ref }) => {
  if (latestCacheKeyRegistries.get(cacheKey) === ref) {
    latestCacheKeyRegistries.delete(cacheKey);
  }
});

/** Marks a registry retired so late runtime calls can reject stale plugin state. */
export function markPluginRegistryRetired(registry: PluginRegistry | null | undefined): void {
  if (registry) {
    retiredRegistries.add(registry);
  }
}

/** Marks a registry active and clears any previous retired state. */
export function markPluginRegistryActive(registry: PluginRegistry | null | undefined): void {
  if (registry) {
    activatedRegistries.add(registry);
    retiredRegistries.delete(registry);
  }
}

/** True when a registry has been activated for runtime use. */
export function isPluginRegistryActivated(registry: PluginRegistry): boolean {
  return activatedRegistries.has(registry);
}

/** True when a registry has been retired by a newer active registry. */
export function isPluginRegistryRetired(registry: PluginRegistry): boolean {
  return retiredRegistries.has(registry);
}

// A registry can stop being the single global active pointer for reasons
// unrelated to itself -- e.g. a different, concurrently-running standalone
// (cron-triggered or isolated-agent) run installing its OWN registry on a
// cache miss. Without this, a still-loaded plugin's in-flight async side
// effect (e.g. scheduling a cron job) races retirement: the registry it
// captured gets retired the instant the OTHER run's registry becomes
// active, so a liveness re-check taken after the async gap reads "retired"
// even though this plugin was never actually unloaded. Held only for the
// duration of the specific async operation, not the registry's whole
// lifetime, so it can't mask a genuine later unload.
export function beginPendingRegistryOperation(
  registry: PluginRegistry | null | undefined,
): () => void {
  if (!registry) {
    return () => {};
  }
  pendingAsyncOperationCounts.set(registry, (pendingAsyncOperationCounts.get(registry) ?? 0) + 1);
  let released = false;
  return () => {
    if (released) {
      return;
    }
    released = true;
    const next = (pendingAsyncOperationCounts.get(registry) ?? 1) - 1;
    if (next <= 0) {
      pendingAsyncOperationCounts.delete(registry);
    } else {
      pendingAsyncOperationCounts.set(registry, next);
    }
  };
}

/** True when a registry has at least one in-flight async operation still pending. */
export function hasPendingRegistryOperation(registry: PluginRegistry): boolean {
  return (pendingAsyncOperationCounts.get(registry) ?? 0) > 0;
}

// Records load context so liveness checks distinguish unrelated active-registry
// swaps from same-context reloads. Only setActivePluginRegistry sets this; pin
// surfaces leave it unset and keep the conservative pending-operation fallback.
// Marking the older same-key generation superseded at install time keeps the
// signal alive even if the active pointer later moves to an unrelated registry
// before a pending side effect re-checks liveness. WeakRef + finalizer keep the
// latest-by-key index lifecycle-owned instead of retaining registries.
export function recordPluginRegistryCacheKey(
  registry: PluginRegistry | null | undefined,
  cacheKey: string | null,
): void {
  if (!registry) {
    return;
  }
  const previousCacheKey = registryCacheKeys.get(registry) ?? null;
  registryCacheKeys.set(registry, cacheKey);
  supersededCacheKeyRegistries.delete(registry);
  if (
    previousCacheKey !== null &&
    latestCacheKeyRegistries.get(previousCacheKey)?.deref() === registry
  ) {
    latestCacheKeyRegistries.delete(previousCacheKey);
  }
  if (cacheKey === null) {
    return;
  }
  const previousLatest = latestCacheKeyRegistries.get(cacheKey)?.deref();
  if (previousLatest && previousLatest !== registry) {
    supersededCacheKeyRegistries.add(previousLatest);
  }
  const ref = new WeakRef(registry);
  latestCacheKeyRegistries.set(cacheKey, ref);
  cacheKeyRegistryFinalizer.unregister(registry);
  cacheKeyRegistryFinalizer.register(registry, { cacheKey, ref }, registry);
}

/** The cache key a registry was activated under, or null if none was recorded. */
export function getPluginRegistryCacheKey(registry: PluginRegistry): string | null {
  return registryCacheKeys.get(registry) ?? null;
}

/** True when a newer registry generation has taken over this registry's load cache key. */
export function isPluginRegistryCacheKeySuperseded(registry: PluginRegistry): boolean {
  return supersededCacheKeyRegistries.has(registry);
}

// Two schedulePluginSessionTurn calls for the same registry can overlap: an
// unrelated swap can protect both via the pending-op pin above, and whichever
// call releases its pin LAST is the one whose retirement check actually fires
// cleanup. That cleanup must preserve every job committed during the shared
// window, not just the job the last-releasing call itself created, or it
// sweeps an earlier call's already-returned job out from under its caller.
export function recordPendingCommittedSchedulerJobId(
  registry: PluginRegistry | null | undefined,
  pluginId: string,
  jobId: string,
): void {
  if (!registry) {
    return;
  }
  let byPlugin = pendingCommittedSchedulerJobIds.get(registry);
  if (!byPlugin) {
    byPlugin = new Map();
    pendingCommittedSchedulerJobIds.set(registry, byPlugin);
  }
  let jobIds = byPlugin.get(pluginId);
  if (!jobIds) {
    jobIds = new Set();
    byPlugin.set(pluginId, jobIds);
  }
  jobIds.add(jobId);
}

/** Committed job ids recorded via recordPendingCommittedSchedulerJobId, keyed by pluginId. */
export function getPendingCommittedSchedulerJobIds(
  registry: PluginRegistry,
): ReadonlyMap<string, ReadonlySet<string>> {
  return pendingCommittedSchedulerJobIds.get(registry) ?? new Map();
}

/** Drops accumulated ids once their shared pending window has fully closed. */
export function clearPendingCommittedSchedulerJobIds(
  registry: PluginRegistry | null | undefined,
): void {
  if (registry) {
    pendingCommittedSchedulerJobIds.delete(registry);
  }
}
