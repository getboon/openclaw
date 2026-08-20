// Browser config mutation tests cover atomic profile replace-on-reattach.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenClawConfig } from "../config/config.js";

const configMocks = vi.hoisted(() => ({
  getRuntimeConfig: vi.fn<() => OpenClawConfig>(),
  writeConfigFile: vi.fn(async (_cfg: OpenClawConfig) => {}),
  mutateConfigFile: vi.fn(
    async (params: {
      mutate: (draft: OpenClawConfig, context: { snapshot: { path: string } }) => unknown;
    }) => {
      const draft = structuredClone(configMocks.getRuntimeConfig());
      // A throw here propagates directly, matching the real writer: nothing
      // below runs and nothing persists when mutate throws.
      const result = await params.mutate(draft, { snapshot: { path: "/tmp/openclaw.json" } });
      await configMocks.writeConfigFile(draft);
      configMocks.getRuntimeConfig.mockReturnValue(draft);
      return {
        path: "/tmp/openclaw.json",
        previousHash: "test-hash",
        persistedHash: "test-hash",
        snapshot: { path: "/tmp/openclaw.json" },
        nextConfig: draft,
        result,
        attempts: 1,
        afterWrite: { mode: "auto" },
        followUp: { action: "none" },
      };
    },
  ),
}));

vi.mock("../config/config.js", async () => {
  const actual = await vi.importActual<typeof import("../config/config.js")>("../config/config.js");
  return {
    ...actual,
    mutateConfigFile: configMocks.mutateConfigFile,
    getRuntimeConfig: configMocks.getRuntimeConfig,
  };
});

const [{ createBrowserProfileConfig }, { resolveBrowserConfig }] = await Promise.all([
  import("./config-mutations.js"),
  import("./config.js"),
]);

describe("createBrowserProfileConfig replaceExisting", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    configMocks.getRuntimeConfig.mockReturnValue({
      browser: {
        defaultProfile: "handoff-example.com",
        profiles: {
          "handoff-example.com": {
            driver: "existing-session",
            attachOnly: true,
            userDataDir: "/old",
            color: "#111111",
          },
        },
      },
    } as unknown as OpenClawConfig);
  });

  it("without replaceExisting, rejects a name conflict (unchanged default behavior)", async () => {
    await expect(
      createBrowserProfileConfig({
        name: "handoff-example.com",
        resolved: resolveBrowserConfig(undefined, undefined),
        driver: "existing-session",
        userDataDir: "/new",
      }),
    ).rejects.toThrow(/already exists/);
  });

  it("with replaceExisting, overwrites the profile in one mutation, preserves defaultProfile and color", async () => {
    const result = await createBrowserProfileConfig({
      name: "handoff-example.com",
      resolved: resolveBrowserConfig(undefined, undefined),
      driver: "existing-session",
      userDataDir: "/new",
      replaceExisting: true,
    });

    expect(result?.userDataDir).toBe("/new");
    expect(result?.color).toBe("#111111");
    const cfg = configMocks.getRuntimeConfig();
    expect(cfg.browser?.profiles?.["handoff-example.com"]?.userDataDir).toBe("/new");
    expect(cfg.browser?.profiles?.["handoff-example.com"]?.color).toBe("#111111");
    expect(cfg.browser?.defaultProfile).toBe("handoff-example.com");
  });

  it("with replaceExisting, an explicit color still overrides the preserved one", async () => {
    const result = await createBrowserProfileConfig({
      name: "handoff-example.com",
      resolved: resolveBrowserConfig(undefined, undefined),
      driver: "existing-session",
      userDataDir: "/new",
      color: "#222222",
      replaceExisting: true,
    });

    expect(result?.color).toBe("#222222");
  });
});
