import { describe, expect, it } from "vitest";
import { buildChannelProgressDraftLine } from "./streaming.js";

describe("buildChannelProgressDraftLine", () => {
  it("drops a benign fs-housekeeping exec chain from the progress card (ENG-16318)", () => {
    const line = buildChannelProgressDraftLine({
      event: "tool",
      name: "exec",
      args: {
        command: 'mkdir -p ~/.openclaw/workspace/scratch && ls ~/.openclaw/ && find / -name "abc*"',
      },
    });

    expect(line).toBeUndefined();
  });

  it("drops a standalone read-only `find /` exec line (ENG-16318)", () => {
    const line = buildChannelProgressDraftLine({
      event: "tool",
      name: "exec",
      args: { command: 'find / -name "abc*"' },
    });

    expect(line).toBeUndefined();
  });

  it("keeps a real-work exec line even when chained with housekeeping (ENG-16318)", () => {
    const line = buildChannelProgressDraftLine({
      event: "tool",
      name: "exec",
      args: { command: "mkdir -p build && python build.py" },
    });

    expect(line).toBeDefined();
    expect(line?.toolName).toBe("exec");
  });

  it("omits generic completed status from successful command output with title", () => {
    const line = buildChannelProgressDraftLine(
      {
        event: "command-output",
        toolCallId: "exec-1",
        phase: "end",
        title: "pwd",
        name: "exec",
        exitCode: 0,
      },
      { commandText: "raw" },
    );

    expect(line).toMatchObject({
      kind: "command-output",
      id: "exec-1",
      text: "🛠️ pwd",
      detail: "pwd",
      status: "completed",
    });
  });

  it("uses the tool label when successful command output has no title", () => {
    const line = buildChannelProgressDraftLine({
      event: "command-output",
      phase: "end",
      name: "exec",
      exitCode: 0,
    });

    expect(line).toMatchObject({
      kind: "command-output",
      text: "🛠️ Exec",
      status: "completed",
    });
    expect(line?.detail).toBeUndefined();
  });

  it("keeps command status and title in raw command progress lines", () => {
    const line = buildChannelProgressDraftLine(
      {
        event: "command-output",
        toolCallId: "exec-1",
        phase: "end",
        title: "command false",
        name: "exec",
        exitCode: 2,
      },
      { commandText: "raw" },
    );

    expect(line).toMatchObject({
      kind: "command-output",
      id: "exec-1",
      text: "🛠️ exit 2; command false",
      detail: "command false",
      status: "exit 2",
    });
  });

  it("prefers real output over the title when a command fails", () => {
    const line = buildChannelProgressDraftLine(
      {
        event: "command-output",
        toolCallId: "exec-2",
        phase: "end",
        title: "command false",
        name: "exec",
        exitCode: 2,
        output: "bash: false: command not found",
      },
      { commandText: "raw" },
    );

    expect(line).toMatchObject({
      kind: "command-output",
      id: "exec-2",
      detail: "bash: false: command not found",
      status: "exit 2",
    });
    expect(line?.text).toContain("bash: false: command not found");
  });

  it("caps oversized command output to the first 500 chars (keeps the head, drops the tail)", () => {
    // Distinguishable head/tail so the assertion catches a regression that
    // truncated from the wrong end (e.g. kept the LAST 500 chars).
    const head = "HEAD-marker-";
    const tail = "-TAIL-marker";
    const oversized = head + "x".repeat(600) + tail; // > 500 chars
    const line = buildChannelProgressDraftLine(
      {
        event: "command-output",
        phase: "end",
        title: "command false",
        name: "exec",
        exitCode: 2,
        output: oversized,
      },
      { commandText: "raw" },
    );

    // 500-char cap (MAX_COMMAND_OUTPUT_DETAIL_CHARS): the surfaced detail is the
    // first 500 chars verbatim — head preserved, tail dropped.
    expect(line).toBeDefined();
    const detail = line?.detail;
    expect(typeof detail).toBe("string");
    expect(detail).toBe(oversized.slice(0, 500));
    expect((detail as string).length).toBe(500);
    expect(detail as string).toContain(head);
    expect(detail as string).not.toContain(tail);
    expect(line?.text).toContain(head);
    expect(line?.text).not.toContain(tail);
  });

  it("falls back to the title when output is absent (no regression)", () => {
    const line = buildChannelProgressDraftLine(
      {
        event: "command-output",
        phase: "end",
        title: "command false",
        name: "exec",
        exitCode: 2,
      },
      { commandText: "raw" },
    );

    expect(line).toMatchObject({ detail: "command false", status: "exit 2" });
  });

  it("falls back to the title when output is only whitespace", () => {
    const line = buildChannelProgressDraftLine(
      {
        event: "command-output",
        phase: "end",
        title: "command false",
        name: "exec",
        exitCode: 2,
        output: "   \n\t  ",
      },
      { commandText: "raw" },
    );

    expect(line).toMatchObject({ detail: "command false", status: "exit 2" });
  });

  it("does not use output on a successful command (no regression)", () => {
    const line = buildChannelProgressDraftLine({
      event: "command-output",
      phase: "end",
      name: "exec",
      exitCode: 0,
      output: "should never appear on success",
    });

    expect(line).toMatchObject({ kind: "command-output", status: "completed" });
    expect(line?.detail).toBeUndefined();
  });

  it("ignores output in status-only mode (no regression)", () => {
    const line = buildChannelProgressDraftLine(
      {
        event: "command-output",
        phase: "end",
        title: "command false",
        name: "exec",
        exitCode: 2,
        output: "bash: false: command not found",
      },
      { commandText: "status" },
    );

    expect(line).toMatchObject({ detail: "exit 2", status: "exit 2" });
    expect(line?.text).not.toContain("bash: false");
  });

  it("keeps only command status in status-only progress lines", () => {
    const line = buildChannelProgressDraftLine(
      {
        event: "command-output",
        phase: "end",
        title: "command false",
        name: "exec",
        exitCode: 2,
      },
      { commandText: "status" },
    );

    expect(line).toMatchObject({
      kind: "command-output",
      text: "🛠️ exit 2",
      detail: "exit 2",
      status: "exit 2",
    });
    expect(line?.text).not.toContain("command false");
  });
});
