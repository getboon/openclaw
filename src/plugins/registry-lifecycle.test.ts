// Verifies plugin registry lifecycle bookkeeping: activation/retirement flags and
// the latest-by-cache-key supersession index that backs isPluginRegistrySuperseded.
import { describe, expect, it } from "vitest";
import { createEmptyPluginRegistry } from "./registry-empty.js";
import {
  isPluginRegistryCacheKeySuperseded,
  markPluginRegistryRetired,
  recordPluginRegistryCacheKey,
} from "./registry-lifecycle.js";

describe("plugin registry cache-key supersession bookkeeping", () => {
  it("marks the older generation superseded once a newer registry takes over the same cache key", () => {
    const older = createEmptyPluginRegistry();
    const newer = createEmptyPluginRegistry();
    recordPluginRegistryCacheKey(older, "shared-key");
    recordPluginRegistryCacheKey(newer, "shared-key");
    expect(isPluginRegistryCacheKeySuperseded(older)).toBe(true);
    expect(isPluginRegistryCacheKeySuperseded(newer)).toBe(false);
  });

  it("drops a retired registry's latest-by-cache-key slot instead of leaving it for GC", () => {
    const registry = createEmptyPluginRegistry();
    recordPluginRegistryCacheKey(registry, "retiring-key");

    markPluginRegistryRetired(registry);

    // Clearing the slot here means a later same-key registry can't mark
    // this retired registry superseded via the cache-key reuse path.
    const laterRegistry = createEmptyPluginRegistry();
    recordPluginRegistryCacheKey(laterRegistry, "retiring-key");
    expect(isPluginRegistryCacheKeySuperseded(registry)).toBe(false);
    expect(isPluginRegistryCacheKeySuperseded(laterRegistry)).toBe(false);
  });
});
