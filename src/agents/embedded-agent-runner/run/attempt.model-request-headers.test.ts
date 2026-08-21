import { describe, expect, it } from "vitest";
import { applyModelRequestHeaders } from "./attempt.js";

const model = {
  id: "claude-haiku",
  name: "Claude Haiku",
  api: "anthropic-messages",
  provider: "boon-llm-gateway",
  baseUrl: "https://llm.example.test/v1",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 200_000,
  maxTokens: 4096,
  headers: {
    "X-Boon-Instance": "acme",
    "X-Boon-Session-ID": "ordinary-session",
  },
} as const;

describe("applyModelRequestHeaders", () => {
  it("applies explicit per-turn headers after cached model headers", () => {
    const result = applyModelRequestHeaders(model, {
      "x-boon-session-id": "provisioning-smoke-run",
      "X-Boon-Provisioning-Smoke-Run-ID": "run-1",
    });

    expect(result.headers).toEqual({
      "X-Boon-Instance": "acme",
      "x-boon-session-id": "provisioning-smoke-run",
      "X-Boon-Provisioning-Smoke-Run-ID": "run-1",
    });
    expect(model.headers?.["X-Boon-Session-ID"]).toBe("ordinary-session");
  });

  it("does not clone the model when no per-turn headers are supplied", () => {
    expect(applyModelRequestHeaders(model)).toBe(model);
  });
});
