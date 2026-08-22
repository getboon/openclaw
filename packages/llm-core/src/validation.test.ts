// LLM Core tests cover validation behavior.
import { describe, expect, it } from "vitest";
import type { Tool } from "./types.js";
import { ToolArgumentValidationError, validateToolArguments } from "./validation.js";

const decimalTool = {
  name: "decimal-tool",
  description: "test tool",
  parameters: {
    type: "object",
    properties: {
      amount: { type: "number" },
      count: { type: "integer" },
    },
    required: ["amount", "count"],
    additionalProperties: false,
  },
} as Tool;

describe("validateToolArguments", () => {
  it("coerces strict decimal numeric strings for plain JSON schemas", () => {
    expect(
      validateToolArguments(decimalTool, {
        type: "toolCall",
        id: "call-1",
        name: "decimal-tool",
        arguments: { amount: "1e3", count: "+3" },
      }),
    ).toEqual({ amount: 1000, count: 3 });
  });

  it("rejects non-decimal numeric strings for plain JSON schemas", () => {
    expect(() =>
      validateToolArguments(decimalTool, {
        type: "toolCall",
        id: "call-1",
        name: "decimal-tool",
        arguments: { amount: "0x10", count: "0b10" },
      }),
    ).toThrow(/Validation failed for tool "decimal-tool"/);
  });

  // Single-line consumers (e.g. extractToolErrorMessage) only ever keep the
  // message's first line, which is always the generic
  // `Validation failed for tool "<name>":` — `summary` exists so they can
  // still see which field failed.
  it("throws a ToolArgumentValidationError with a single-line summary of every field issue", () => {
    let caught: unknown;
    try {
      validateToolArguments(decimalTool, {
        type: "toolCall",
        id: "call-1",
        name: "decimal-tool",
        arguments: { amount: "0x10" },
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ToolArgumentValidationError);
    const error = caught as ToolArgumentValidationError;
    expect(error.toolName).toBe("decimal-tool");
    expect(error.summary).not.toContain("\n");
    expect(error.summary).toContain("count");
    expect(error.message).toContain("Received arguments:");
  });
});
