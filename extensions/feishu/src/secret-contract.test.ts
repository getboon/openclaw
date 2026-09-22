// Feishu tests cover secret contract plugin behavior.
import type { OpenClawConfig } from "openclaw/plugin-sdk/config-contracts";
import {
  applyResolvedAssignments,
  createResolverContext,
  resolveSecretRefValues,
} from "openclaw/plugin-sdk/secret-ref-runtime";
import { describe, expect, it } from "vitest";
import { collectRuntimeConfigAssignments } from "./secret-contract.js";

async function resolveFeishuSecretAssignments(
  sourceConfig: OpenClawConfig,
  env: NodeJS.ProcessEnv,
): Promise<OpenClawConfig> {
  const resolvedConfig: OpenClawConfig = structuredClone(sourceConfig);
  const context = createResolverContext({ sourceConfig, env });

  collectRuntimeConfigAssignments({
    config: resolvedConfig,
    defaults: sourceConfig.secrets?.defaults,
    context,
  });

  const resolved = await resolveSecretRefValues(
    context.assignments.map((assignment) => assignment.ref),
    {
      config: sourceConfig,
      env: context.env,
      cache: context.cache,
    },
  );
  applyResolvedAssignments({ assignments: context.assignments, resolved });

  return resolvedConfig;
}

describe("feishu secret contract", () => {
  it("keeps the implicit default account top-level appSecret active with named accounts", async () => {
    const resolvedConfig = await resolveFeishuSecretAssignments(
      {
        channels: {
          feishu: {
            enabled: true,
            appId: "cli_default",
            appSecret: { source: "env", provider: "default", id: "FEISHU_DEFAULT_SECRET" },
            accounts: {
              team2: {
                enabled: true,
                appId: "cli_team2",
                appSecret: { source: "env", provider: "default", id: "FEISHU_TEAM2_SECRET" },
              },
            },
          },
        },
      } as OpenClawConfig,
      {
        FEISHU_DEFAULT_SECRET: "resolved-default-secret",
        FEISHU_TEAM2_SECRET: "resolved-team2-secret",
      },
    );

    expect(resolvedConfig.channels?.feishu?.appSecret).toBe("resolved-default-secret");
    expect(resolvedConfig.channels?.feishu?.accounts?.team2?.appSecret).toBe(
      "resolved-team2-secret",
    );
  });

  it("does not activate the implicit default account when accounts.default is explicitly disabled", async () => {
    const defaultSecretRef = { source: "env", provider: "default", id: "FEISHU_DEFAULT_SECRET" };
    const resolvedConfig = await resolveFeishuSecretAssignments(
      {
        channels: {
          feishu: {
            enabled: true,
            appId: "cli_default",
            appSecret: defaultSecretRef,
            accounts: {
              default: { enabled: false },
              team2: {
                enabled: true,
                appId: "cli_team2",
                appSecret: { source: "env", provider: "default", id: "FEISHU_TEAM2_SECRET" },
              },
            },
          },
        },
      } as OpenClawConfig,
      {
        FEISHU_DEFAULT_SECRET: "resolved-default-secret",
        FEISHU_TEAM2_SECRET: "resolved-team2-secret",
      },
    );

    // The disabled default account's top-level appSecret ref must not be
    // resolved: it stays exactly the unresolved SecretRef object.
    expect(resolvedConfig.channels?.feishu?.appSecret).toEqual(defaultSecretRef);
    expect(resolvedConfig.channels?.feishu?.accounts?.team2?.appSecret).toBe(
      "resolved-team2-secret",
    );
  });
});
