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

  it(
    "drops a retired registry's latest-by-cache-key slot immediately, instead of leaving it " +
      "for real GC to eventually reclaim -- a gateway cycling through many distinct cache keys " +
      "would otherwise keep accumulating one map entry per key until each retired registry " +
      "happens to be collected",
    () => {
      const registry = createEmptyPluginRegistry();
      recordPluginRegistryCacheKey(registry, "retiring-key");

      markPluginRegistryRetired(registry);

      // A later registry reusing the SAME cache key finds no stale "latest"
      // entry still pointing at the retired one. If the slot had been left
      // in place, this call would mark the (already-retired) registry
      // superseded too, via the exact same-key-reuse path the first test
      // above exercises -- observable proof the slot was actually cleared,
      // not just that isPluginRegistrySuperseded happens to already be true
      // via the separate retired flag.
      const laterRegistry = createEmptyPluginRegistry();
      recordPluginRegistryCacheKey(laterRegistry, "retiring-key");
      expect(isPluginRegistryCacheKeySuperseded(registry)).toBe(false);
      expect(isPluginRegistryCacheKeySuperseded(laterRegistry)).toBe(false);
    },
  );
});
