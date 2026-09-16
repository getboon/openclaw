// Plugin location bridge tests cover CLI plugin path bridging between install surfaces.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { InstalledPluginIndex } from "../plugins/installed-plugin-index.js";
import type { InstalledPluginStartupInfo } from "../plugins/installed-plugin-index.js";
import type { PluginManifestRegistry } from "../plugins/manifest-registry.js";

const readPersistedInstalledPluginIndexMock = vi.fn();
const loadPluginManifestRegistryForInstalledIndexMock = vi.fn();

const startupInfo: InstalledPluginStartupInfo = {
  sidecar: false,
  memory: false,
  deferConfiguredChannelFullLoadUntilAfterListen: false,
  agentHarnesses: [],
};

vi.mock("../plugins/installed-plugin-index-store.js", () => ({
  readPersistedInstalledPluginIndex: (...args: unknown[]) =>
    readPersistedInstalledPluginIndexMock(...args),
}));

vi.mock("../plugins/manifest-registry-installed.js", () => ({
  loadPluginManifestRegistryForInstalledIndex: (...args: unknown[]) =>
    loadPluginManifestRegistryForInstalledIndexMock(...args),
}));

const { listPersistedBundledPluginLocationBridges, listPersistedBundledPluginRecoveryLocations } =
  await import("./plugins-location-bridges.js");

function makeIndex(record: InstalledPluginIndex["plugins"][number]): InstalledPluginIndex {
  return {
    version: 1,
    hostContractVersion: "2026.5.2",
    compatRegistryVersion: "test",
    migrationVersion: 1,
    policyHash: "test",
    generatedAtMs: 1,
    refreshReason: "manual",
    installRecords: {},
    plugins: [record],
    diagnostics: [],
  };
}

function makeRegistry(pluginId: string): PluginManifestRegistry {
  return {
    plugins: [
      {
        id: pluginId,
        name: pluginId,
        rootDir: `/app/dist/extensions/${pluginId}`,
        source: `/app/dist/extensions/${pluginId}/index.js`,
        origin: "bundled",
        channels: [pluginId],
        providers: [],
        cliBackends: [],
        syntheticAuthRefs: [],
        nonSecretAuthMarkers: [],
        skills: [],
        settingsFiles: [],
        hooks: [],
        configContracts: [],
        activation: {},
        startup: {},
        packageInstall: {
          clawhubSpec: `clawhub:@openclaw/${pluginId}`,
          npmSpec: `@openclaw/${pluginId}`,
          defaultChoice: "clawhub",
        },
      },
    ],
    diagnostics: [],
  } as unknown as PluginManifestRegistry;
}

describe("listPersistedBundledPluginLocationBridges", () => {
  beforeEach(() => {
    readPersistedInstalledPluginIndexMock.mockReset();
    loadPluginManifestRegistryForInstalledIndexMock.mockReset();
  });

  it("keeps persisted bundled relocations npm-first for launch", async () => {
    readPersistedInstalledPluginIndexMock.mockResolvedValue(
      makeIndex({
        pluginId: "diagnostics-prometheus",
        manifestPath: "/app/dist/extensions/diagnostics-prometheus/openclaw.plugin.json",
        manifestHash: "hash",
        source: "/app/dist/extensions/diagnostics-prometheus/index.js",
        rootDir: "/app/dist/extensions/diagnostics-prometheus",
        origin: "bundled",
        enabled: true,
        startup: startupInfo,
        compat: [],
        packageInstall: {
          defaultChoice: "clawhub",
          clawhub: {
            spec: "clawhub:@openclaw/diagnostics-prometheus",
            packageName: "@openclaw/diagnostics-prometheus",
            exactVersion: false,
          },
          npm: {
            spec: "@openclaw/diagnostics-prometheus",
            packageName: "@openclaw/diagnostics-prometheus",
            selectorKind: "none",
            exactVersion: false,
            pinState: "floating-without-integrity",
          },
          warnings: [],
        },
      }),
    );
    loadPluginManifestRegistryForInstalledIndexMock.mockReturnValue(
      makeRegistry("diagnostics-prometheus"),
    );

    await expect(listPersistedBundledPluginLocationBridges({})).resolves.toEqual([
      {
        bundledPluginId: "diagnostics-prometheus",
        pluginId: "diagnostics-prometheus",
        preferredSource: "npm",
        npmSpec: "@openclaw/diagnostics-prometheus",
        clawhubSpec: "clawhub:@openclaw/diagnostics-prometheus",
        channelIds: ["diagnostics-prometheus"],
      },
    ]);
  });

  it("uses official external catalog metadata when the persisted bundled row lacks npm metadata", async () => {
    readPersistedInstalledPluginIndexMock.mockResolvedValue(
      makeIndex({
        pluginId: "diagnostics-prometheus",
        manifestPath: "/app/dist/extensions/diagnostics-prometheus/openclaw.plugin.json",
        manifestHash: "hash",
        source: "/app/dist/extensions/diagnostics-prometheus/index.js",
        rootDir: "/app/dist/extensions/diagnostics-prometheus",
        origin: "bundled",
        enabled: true,
        startup: startupInfo,
        compat: [],
        packageInstall: {
          defaultChoice: "clawhub",
          clawhub: {
            spec: "clawhub:@openclaw/diagnostics-prometheus",
            packageName: "@openclaw/diagnostics-prometheus",
            exactVersion: false,
          },
          warnings: [],
        },
      }),
    );
    loadPluginManifestRegistryForInstalledIndexMock.mockReturnValue(
      makeRegistry("diagnostics-prometheus"),
    );

    await expect(listPersistedBundledPluginLocationBridges({})).resolves.toEqual([
      {
        bundledPluginId: "diagnostics-prometheus",
        pluginId: "diagnostics-prometheus",
        preferredSource: "npm",
        npmSpec: "@openclaw/diagnostics-prometheus",
        clawhubSpec: "clawhub:@openclaw/diagnostics-prometheus",
        channelIds: ["diagnostics-prometheus"],
      },
    ]);
  });

  it("does not create a relocation bridge without persisted or official install metadata", async () => {
    readPersistedInstalledPluginIndexMock.mockResolvedValue(
      makeIndex({
        pluginId: "local-only",
        manifestPath: "/app/dist/extensions/local-only/openclaw.plugin.json",
        manifestHash: "hash",
        source: "/app/dist/extensions/local-only/index.js",
        rootDir: "/app/dist/extensions/local-only",
        origin: "bundled",
        enabled: true,
        startup: startupInfo,
        compat: [],
        packageInstall: {
          warnings: [],
        },
      }),
    );
    loadPluginManifestRegistryForInstalledIndexMock.mockReturnValue(makeRegistry("local-only"));

    await expect(listPersistedBundledPluginLocationBridges({})).resolves.toStrictEqual([]);
  });
});

describe("listPersistedBundledPluginRecoveryLocations", () => {
  beforeEach(() => {
    readPersistedInstalledPluginIndexMock.mockReset();
    loadPluginManifestRegistryForInstalledIndexMock.mockReset();
  });

  it("includes exact packaged and legacy paths for disabled bundled records", async () => {
    readPersistedInstalledPluginIndexMock.mockResolvedValue(
      makeIndex({
        pluginId: "diagnostics-prometheus",
        manifestPath: "/app/dist/extensions/diagnostics-prometheus/openclaw.plugin.json",
        manifestHash: "hash",
        source: "/app/dist/extensions/diagnostics-prometheus/index.js",
        rootDir: "/app/dist/extensions/diagnostics-prometheus",
        origin: "bundled",
        enabled: false,
        startup: startupInfo,
        compat: [],
      }),
    );

    await expect(listPersistedBundledPluginRecoveryLocations({})).resolves.toEqual([
      {
        pluginId: "diagnostics-prometheus",
        loadPaths: [
          "/app/dist/extensions/diagnostics-prometheus",
          "/app/extensions/diagnostics-prometheus",
        ],
      },
    ]);
  });

  it("does not use a relative persisted bundled root as ownership proof", async () => {
    readPersistedInstalledPluginIndexMock.mockResolvedValue(
      makeIndex({
        pluginId: "diagnostics-prometheus",
        manifestPath: "extensions/diagnostics-prometheus/openclaw.plugin.json",
        manifestHash: "hash",
        source: "extensions/diagnostics-prometheus/index.js",
        rootDir: "extensions/diagnostics-prometheus",
        origin: "bundled",
        enabled: true,
        startup: startupInfo,
        compat: [],
      }),
    );
    await expect(listPersistedBundledPluginRecoveryLocations({})).resolves.toStrictEqual([]);
  });
});
