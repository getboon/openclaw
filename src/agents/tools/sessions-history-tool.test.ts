// sessions_history tool tests cover recall redaction and input validation for
// session transcript history returned to models.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { callGateway as gatewayCall } from "../../gateway/call.js";

type CallGatewayRequest = Parameters<typeof gatewayCall>[0];

let createSessionsHistoryTool: typeof import("./sessions-history-tool.js").createSessionsHistoryTool;
let previousConfigPath: string | undefined;
let tempDir: string | undefined;

function useLoggingConfig(name: string, logging: Record<string, unknown>): void {
  if (!tempDir) {
    throw new Error("tempDir not initialized");
  }
  const configPath = path.join(tempDir, name);
  fs.writeFileSync(configPath, `${JSON.stringify({ logging })}\n`, "utf8");
  process.env.OPENCLAW_CONFIG_PATH = configPath;
}

/**
 * Shared beforeAll/afterAll lifecycle for a describe block that needs its
 * own temp config dir with log redaction disabled: creates the dir + config
 * and dynamically imports the tool under test, then restores the prior
 * config path and removes the dir.
 */
function useSessionsHistoryTestConfig(tempDirPrefix: string): {
  setup: () => Promise<void>;
  teardown: () => void;
} {
  return {
    setup: async () => {
      previousConfigPath = process.env.OPENCLAW_CONFIG_PATH;
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), tempDirPrefix));
      useLoggingConfig("redaction-off.json", { redactSensitive: "off" });
      ({ createSessionsHistoryTool } = await import("./sessions-history-tool.js"));
    },
    teardown: () => {
      if (previousConfigPath === undefined) {
        delete process.env.OPENCLAW_CONFIG_PATH;
      } else {
        process.env.OPENCLAW_CONFIG_PATH = previousConfigPath;
      }
      if (tempDir) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    },
  };
}

function createHistoryToolWithMessage(content: string) {
  return createSessionsHistoryTool({
    config: {},
    callGateway: async <T = Record<string, unknown>>(request: CallGatewayRequest): Promise<T> => {
      if (request.method === "chat.history") {
        return {
          messages: [
            {
              role: "user",
              content,
            },
          ],
        } as T;
      }
      return {} as T;
    },
  });
}

describe("sessions_history redaction", () => {
  const lifecycle = useSessionsHistoryTestConfig("openclaw-sessions-history-redact-");
  beforeAll(lifecycle.setup);
  afterAll(lifecycle.teardown);

  it("redacts recalled session text even when log redaction is disabled", async () => {
    // Recalled transcript content is model-visible, so it is always redacted
    // even when normal logging redaction is configured off.
    useLoggingConfig("redaction-off.json", { redactSensitive: "off" });
    const tool = createHistoryToolWithMessage("OPENROUTER_API_KEY=sk-or-v1-abcdef0123456789");

    const result = await tool.execute("call-1", { sessionKey: "main" });
    const serialized = JSON.stringify(result.details);

    expect(serialized).not.toContain("sk-or-v1-abcdef0123456789");
    expect(serialized).toContain("OPENROUTER_API_KEY=");
    expect((result.details as { contentRedacted?: unknown }).contentRedacted).toBe(true);
  });

  it("applies custom redaction patterns to recalled session text", async () => {
    useLoggingConfig("custom-patterns.json", {
      redactSensitive: "off",
      redactPatterns: [String.raw`\binternal-ticket-[A-Za-z0-9]+\b`],
    });
    const tool = createHistoryToolWithMessage("follow up on internal-ticket-AbC12345");

    const result = await tool.execute("call-1", { sessionKey: "main" });
    const serialized = JSON.stringify(result.details);

    expect(serialized).not.toContain("internal-ticket-AbC12345");
    expect(serialized).toContain("intern");
    expect((result.details as { contentRedacted?: unknown }).contentRedacted).toBe(true);
  });

  it.each([0, 1.5])("rejects invalid limit value %s", async (limit) => {
    const tool = createHistoryToolWithMessage("hello");

    await expect(tool.execute("call-1", { sessionKey: "main", limit })).rejects.toThrow(
      "limit must be a positive integer",
    );
  });
});

describe("sessions_history raw-window undercounting", () => {
  const lifecycle = useSessionsHistoryTestConfig("openclaw-sessions-history-window-");
  beforeAll(lifecycle.setup);
  afterAll(lifecycle.teardown);

  // Builds a raw transcript tail matching the live shape from thread 1141: a
  // toolCall/thinking-only assistant stub immediately followed by the
  // delivery-mirror entry that carries the actual reply text, repeated back
  // to back so a shallow raw window is mostly noise.
  function buildNoisyTranscript(turnCount: number): unknown[] {
    const messages: unknown[] = [];
    for (let i = 0; i < turnCount; i += 1) {
      messages.push({ role: "user", content: `question ${i}` });
      messages.push({
        role: "assistant",
        model: "claude-opus-4-7-bedrock",
        content: [
          { type: "thinking", thinking: "planning..." },
          { type: "toolCall", name: "message", input: { message: `answer ${i}` } },
        ],
      });
      messages.push({ role: "toolResult", content: "ok" });
      messages.push({
        role: "assistant",
        model: "delivery-mirror",
        content: [{ type: "text", text: `answer ${i}` }],
      });
    }
    return messages;
  }

  it("grows the raw window so a shallow limit still returns enough real turns", async () => {
    const fullTranscript = buildNoisyTranscript(30); // 120 raw entries, 30 real turns
    const requestedLimits: number[] = [];
    const tool = createSessionsHistoryTool({
      config: {},
      callGateway: async <T = Record<string, unknown>>(request: CallGatewayRequest): Promise<T> => {
        if (request.method === "chat.history") {
          const rawLimit = (request.params as { limit?: number }).limit ?? 0;
          requestedLimits.push(rawLimit);
          return { messages: fullTranscript.slice(-rawLimit) } as T;
        }
        return {} as T;
      },
    });

    const result = await tool.execute("call-1", { sessionKey: "main", limit: 10 });
    const details = result.details as {
      messages: Array<{ role?: string; model?: string }>;
      droppedMessages: boolean;
    };

    // A naive raw-count read of the last 10 entries would return only 2 real
    // turns worth of content (mostly toolResult/thinking-stub noise); the
    // grow step must widen the raw fetch until the requested 10 logical
    // messages (5 user + 5 delivery-mirror replies) come back, with no
    // leftover toolResult/thinking-only-stub noise.
    expect(details.messages).toHaveLength(10);
    expect(details.messages.every((m) => m.role === "user" || m.model === "delivery-mirror")).toBe(
      true,
    );
    expect(requestedLimits.length).toBeGreaterThan(1);
    expect(requestedLimits[requestedLimits.length - 1]).toBeGreaterThan(requestedLimits[0]);
    // More real history exists before this window (30 turns total, 5 returned).
    expect(details.droppedMessages).toBe(true);
  });

  it("does not report truncation when the session ends exactly at the requested limit", async () => {
    const wholeSession = Array.from({ length: 5 }, (_, i) => ({
      role: i % 2 === 0 ? "user" : "assistant",
      content: `turn ${i}`,
    }));
    const tool = createSessionsHistoryTool({
      config: {},
      callGateway: async <T = Record<string, unknown>>(request: CallGatewayRequest): Promise<T> => {
        if (request.method === "chat.history") {
          // The whole session is shorter than even the overread request, so
          // there is genuinely nothing more before it.
          return { messages: wholeSession } as T;
        }
        return {} as T;
      },
    });

    const result = await tool.execute("call-1", { sessionKey: "main", limit: 5 });
    const details = result.details as { messages: unknown[]; droppedMessages: boolean };

    expect(details.messages).toHaveLength(5);
    expect(details.droppedMessages).toBe(false);
  });

  it("flags truncation when the caller asks for more than the gateway's hard cap", async () => {
    const tool = createSessionsHistoryTool({
      config: {},
      callGateway: async <T = Record<string, unknown>>(request: CallGatewayRequest): Promise<T> => {
        if (request.method === "chat.history") {
          // Requesting a limit above the gateway's hard cap must clamp, not
          // ask for (or crash on) more than the cap.
          expect((request.params as { limit?: number }).limit).toBeLessThanOrEqual(1000);
          return { messages: [{ role: "user", content: "hi" }] } as T;
        }
        return {} as T;
      },
    });

    const result = await tool.execute("call-1", { sessionKey: "main", limit: 2000 });
    const details = result.details as { droppedMessages: boolean };

    // A limit above the hard cap can never be fully satisfied, regardless of
    // how little history the session actually has.
    expect(details.droppedMessages).toBe(true);
  });

  it("drops tool-plumbing-only assistant stubs but keeps their delivery-mirror text", async () => {
    const tool = createSessionsHistoryTool({
      config: {},
      callGateway: async <T = Record<string, unknown>>(): Promise<T> => {
        return {
          messages: [
            { role: "user", content: "kick off the takeoff" },
            {
              role: "assistant",
              model: "claude-opus-4-7-bedrock",
              content: [
                { type: "thinking", thinking: "..." },
                { type: "toolCall", name: "message", input: { message: "on it" } },
              ],
            },
            { role: "toolResult", content: "ok" },
            {
              role: "assistant",
              model: "delivery-mirror",
              content: [{ type: "text", text: "On it — kicking off the takeoff." }],
            },
          ],
        } as T;
      },
    });

    const result = await tool.execute("call-1", { sessionKey: "main", limit: 10 });
    const details = result.details as { messages: Array<{ role?: string; model?: string }> };

    expect(details.messages).toHaveLength(2);
    expect(details.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(details.messages[1]?.model).toBe("delivery-mirror");
  });
});
