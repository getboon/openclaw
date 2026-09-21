/** Tracks active and retired plugin registries so stale runtime calls can be rejected. */
import type { PluginRegistry } from "./registry-types.js";

const retiredRegistries = new WeakSet<PluginRegistry>();
const activatedRegistries = new WeakSet<PluginRegistry>();
const pendingAsyncOperationCounts = new WeakMap<PluginRegistry, number>();
const registryCacheKeys = new WeakMap<PluginRegistry, string | null>();

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

// Standalone registries are loaded and re-loaded under a cache key derived from
// their own load context (session/tenant, config, etc.) -- see
// resolvePluginRegistryLoadCacheKey. Recording it here lets a later check tell
// "this registry's own context reloaded into a fresh registry generation" (same
// cache key taking over as active) apart from "an unrelated context's registry
// happened to become active" (a different cache key, or no cache key at all).
// Only setActivePluginRegistry records this; registries activated through the
// pin surfaces (channel/http-route/session-extension) never get a key, so they
// fall back to the conservative default below.
export function recordPluginRegistryCacheKey(
  registry: PluginRegistry | null | undefined,
  cacheKey: string | null,
): void {
  if (registry) {
    registryCacheKeys.set(registry, cacheKey);
  }
}

/** The cache key a registry was activated under, or null if none was recorded. */
export function getPluginRegistryCacheKey(registry: PluginRegistry): string | null {
  return registryCacheKeys.get(registry) ?? null;
}
