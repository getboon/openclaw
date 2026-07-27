import { describe, expect, it } from "vitest";
import { resolveMessageAudience } from "./message-audience.js";
import type { OpenClawConfig } from "./types.openclaw.js";

function cfgWithAudience(audience: unknown): OpenClawConfig {
  return { agents: { defaults: { messaging: { audience } } } } as unknown as OpenClawConfig;
}

describe("resolveMessageAudience", () => {
  it("defaults to operator when config is undefined", () => {
    expect(resolveMessageAudience(undefined)).toBe("operator");
  });

  it("defaults to operator when messaging is unset", () => {
    expect(resolveMessageAudience({} as OpenClawConfig)).toBe("operator");
    expect(resolveMessageAudience({ agents: { defaults: {} } } as OpenClawConfig)).toBe("operator");
  });

  it("returns operator when explicitly set", () => {
    expect(resolveMessageAudience(cfgWithAudience("operator"))).toBe("operator");
  });

  it("returns consumer when explicitly set", () => {
    expect(resolveMessageAudience(cfgWithAudience("consumer"))).toBe("consumer");
  });

  it("collapses unexpected values to operator", () => {
    expect(resolveMessageAudience(cfgWithAudience("bogus"))).toBe("operator");
    expect(resolveMessageAudience(cfgWithAudience(""))).toBe("operator");
    expect(resolveMessageAudience(cfgWithAudience(null))).toBe("operator");
  });
});
