import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
  execFile: vi.fn(),
}));

import { execFile, spawn } from "node:child_process";
import { registerBoonPdfPrep, type BoonPdfPrepApi } from "./register.js";

const HEX_A = "a".repeat(64);
const HEX_B = "b".repeat(64);
const PDF_LINE = "[media attached: media://inbound/plans---1.pdf (application/pdf)]";

type ExecCallback = (error: Error | null, stdout: string, stderr: string) => void;

class FakeChild extends EventEmitter {
  kill = vi.fn(() => true);
}

function statusJson(files: Record<string, unknown>[]): string {
  return JSON.stringify({ status: "success", files });
}

function fileRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    input: "media://inbound/plans---1.pdf",
    file_hash: `sha256:${HEX_A}`,
    state: "ready",
    pages_done: 6,
    total_pages: 6,
    eta_s: null,
    file_name: "plans.pdf",
    reason: null,
    ...overrides,
  };
}

function mockStatus(result: { stdout?: string; error?: Error }) {
  vi.mocked(execFile).mockImplementation(((...args: unknown[]) => {
    const callback = args.at(-1) as ExecCallback;
    queueMicrotask(() => callback(result.error ?? null, result.stdout ?? "", ""));
    return new FakeChild();
  }) as unknown as typeof execFile);
}

function setup() {
  const on = vi.fn<BoonPdfPrepApi["on"]>();
  registerBoonPdfPrep({ on });
  const handler = (name: string) => {
    const found = on.mock.calls.find((call) => call[0] === name)?.[1];
    expect(found).toBeDefined();
    return found as (event: unknown, ctx: unknown) => unknown;
  };
  return {
    on,
    messageReceived: handler("message_received"),
    beforePromptBuild: (prompt: string) =>
      handler("before_prompt_build")({ prompt, messages: [] }, {}) as Promise<
        { appendContext: string } | undefined
      >,
  };
}

beforeEach(() => {
  vi.mocked(spawn).mockImplementation((() => new FakeChild()) as unknown as typeof spawn);
});

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("registerBoonPdfPrep", () => {
  it("registers the two hooks", () => {
    const { on } = setup();
    expect(on.mock.calls.map((call) => call[0])).toEqual([
      "message_received",
      "before_prompt_build",
    ]);
  });
});

describe("message_received", () => {
  it("spawns one enqueue with an argv array for the PDF paths only", () => {
    const { messageReceived } = setup();
    messageReceived(
      {
        from: "u",
        content: "",
        metadata: {
          mediaPaths: ["/s/a.bin", "/s/b.png", "/s/c.PDF", 7],
          mediaTypes: ["application/pdf", "image/png"],
        },
      },
      {},
    );
    expect(spawn).toHaveBeenCalledOnce();
    expect(spawn).toHaveBeenCalledWith("pdf-index", ["enqueue", "/s/a.bin", "/s/c.PDF"], {
      stdio: "ignore",
      detached: false,
    });
  });

  it.each([
    { label: "no media", metadata: undefined },
    { label: "no PDF", metadata: { mediaPaths: ["/s/a.png"], mediaTypes: ["image/png"] } },
    { label: "malformed media", metadata: { mediaPaths: "/s/a.pdf" } },
  ])("does not spawn for $label", ({ metadata }) => {
    const { messageReceived } = setup();
    messageReceived({ from: "u", content: "", metadata }, {});
    expect(spawn).not.toHaveBeenCalled();
  });

  it("swallows a thrown spawn error and a child error event", () => {
    const { messageReceived } = setup();
    const event = { from: "u", content: "", metadata: { mediaPaths: ["/s/a.pdf"] } };
    vi.mocked(spawn).mockImplementationOnce(() => {
      throw new Error("spawn failed");
    });
    expect(() => messageReceived(event, {})).not.toThrow();

    const child = new FakeChild();
    vi.mocked(spawn).mockImplementationOnce((() => child) as unknown as typeof spawn);
    messageReceived(event, {});
    expect(() => child.emit("error", new Error("ENOENT"))).not.toThrow();
  });
});

describe("before_prompt_build", () => {
  it("returns undefined without PDF media lines and runs no status", async () => {
    const { beforePromptBuild } = setup();
    await expect(
      beforePromptBuild("[media attached: /s/a.png (image/png)]"),
    ).resolves.toBeUndefined();
    expect(execFile).not.toHaveBeenCalled();
  });

  it("runs status with an argv array and a 1.5 s budget", async () => {
    vi.useFakeTimers();
    vi.mocked(execFile).mockImplementation((() => new FakeChild()) as unknown as typeof execFile);
    const { beforePromptBuild } = setup();
    const result = beforePromptBuild(PDF_LINE);
    expect(vi.mocked(execFile).mock.calls[0]?.slice(0, 2)).toEqual([
      "pdf-index",
      ["status", "media://inbound/plans---1.pdf"],
    ]);
    const child = vi.mocked(execFile).mock.results[0]?.value as FakeChild;
    await vi.advanceTimersByTimeAsync(1_499);
    expect(child.kill).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await expect(result).resolves.toBeUndefined();
    expect(child.kill).toHaveBeenCalledWith("SIGKILL");
  });

  it("notes a ready PDF on first sight only", async () => {
    mockStatus({ stdout: statusJson([fileRecord()]) });
    const { beforePromptBuild } = setup();
    await expect(beforePromptBuild(PDF_LINE)).resolves.toEqual({
      appendContext: [
        "[PDF preparation]",
        `- "plans.pdf" (sha256 ${HEX_A}): 6 pages. Ready.`,
        'Use: pdf-index search <sha256> --q="<keywords>". The result states its coverage.',
      ].join("\n"),
    });
    await expect(beforePromptBuild(PDF_LINE)).resolves.toBeUndefined();
  });

  it("notes a partly prepared PDF on every turn with its coverage", async () => {
    mockStatus({
      stdout: statusJson([
        fileRecord({ state: "text", pages_done: 400, total_pages: 1546, eta_s: 57 }),
      ]),
    });
    const { beforePromptBuild } = setup();
    for (let turn = 0; turn < 2; turn += 1) {
      const result = await beforePromptBuild(PDF_LINE);
      expect(result?.appendContext).toContain(
        "1546 pages. Text search covers pages 1-400. The rest in about 57 s.",
      );
    }
    expect(spawn).not.toHaveBeenCalled();
  });

  it("notes a PDF once as ready after earlier progress lines", async () => {
    const { beforePromptBuild } = setup();
    const lines = async () => (await beforePromptBuild(PDF_LINE))?.appendContext.split("\n")[1];
    mockStatus({ stdout: statusJson([fileRecord({ state: "text", pages_done: 3, eta_s: 1 })]) });
    expect(await lines()).toContain("Text search covers pages 1-3.");
    mockStatus({ stdout: statusJson([fileRecord()]) });
    expect(await lines()).toBe(`- "plans.pdf" (sha256 ${HEX_A}): 6 pages. Ready.`);
    await expect(beforePromptBuild(PDF_LINE)).resolves.toBeUndefined();
  });

  it("forgets the oldest ready hash after 1,000 hashes", async () => {
    const { beforePromptBuild } = setup();
    const hex = (i: number) => i.toString(16).padStart(64, "0");
    for (let i = 0; i <= 1_000; i += 1) {
      mockStatus({ stdout: statusJson([fileRecord({ file_hash: `sha256:${hex(i)}` })]) });
      await expect(beforePromptBuild(PDF_LINE)).resolves.toBeDefined();
    }
    mockStatus({ stdout: statusJson([fileRecord({ file_hash: `sha256:${hex(1_000)}` })]) });
    await expect(beforePromptBuild(PDF_LINE)).resolves.toBeUndefined();
    mockStatus({ stdout: statusJson([fileRecord({ file_hash: `sha256:${hex(0)}` })]) });
    await expect(beforePromptBuild(PDF_LINE)).resolves.toBeDefined();
  });

  it("returns undefined when status exits with an unknown command error", async () => {
    const stdout = JSON.stringify({
      status: "error",
      error_type: "validation",
      message: "Unknown command: status. Run 'pdf-index help' for usage.",
      retryable: false,
    });
    mockStatus({ stdout, error: Object.assign(new Error("Command failed"), { code: 2 }) });
    const { beforePromptBuild } = setup();
    await expect(beforePromptBuild(PDF_LINE)).resolves.toBeUndefined();
  });

  it("returns undefined and leaves no timer when status cannot start", async () => {
    vi.useFakeTimers();
    vi.mocked(execFile).mockImplementation(() => {
      throw new Error("spawn failed");
    });
    const { beforePromptBuild } = setup();
    await expect(beforePromptBuild(PDF_LINE)).resolves.toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    { label: "bad JSON", stdout: "not json" },
    { label: "an error status", stdout: JSON.stringify({ status: "error" }) },
    { label: "a file count mismatch", stdout: statusJson([]) },
    { label: "an unknown state", stdout: statusJson([fileRecord({ state: "indexing" })]) },
  ])("returns undefined for $label", async ({ stdout }) => {
    mockStatus({ stdout });
    const { beforePromptBuild } = setup();
    await expect(beforePromptBuild(PDF_LINE)).resolves.toBeUndefined();
  });

  it("enqueues unknown refs once and notes only the known ones", async () => {
    const prompt = [
      "[media attached: 3 files]",
      "[media attached 1/3: media://inbound/a.pdf (application/pdf)]",
      "[media attached 2/3: media://inbound/b.pdf (application/pdf)]",
      "[media attached 3/3: media://inbound/c.pdf (application/pdf)]",
    ].join("\n");
    mockStatus({
      stdout: statusJson([
        fileRecord({ state: "unknown", file_hash: null, file_name: null }),
        fileRecord({ file_hash: `sha256:${HEX_B}`, state: "queued", total_pages: null }),
        fileRecord({ state: "unknown", file_name: null }),
      ]),
    });
    const { beforePromptBuild } = setup();
    const result = await beforePromptBuild(prompt);
    expect(spawn).toHaveBeenCalledOnce();
    expect(spawn).toHaveBeenCalledWith(
      "pdf-index",
      ["enqueue", "media://inbound/a.pdf", "media://inbound/c.pdf"],
      { stdio: "ignore", detached: false },
    );
    expect(result?.appendContext.split("\n").slice(1, -1)).toEqual([
      `- "plans.pdf" (sha256 ${HEX_B}): Queued.`,
    ]);
  });

  it("writes one line per hash when two refs share a file", async () => {
    const prompt = [
      "[media attached 1/2: media://inbound/a.pdf (application/pdf)]",
      "[media attached 2/2: media://inbound/b.pdf (application/pdf)]",
    ].join("\n");
    mockStatus({
      stdout: statusJson([fileRecord({ state: "queued" }), fileRecord({ state: "queued" })]),
    });
    const { beforePromptBuild } = setup();
    const result = await beforePromptBuild(prompt);
    expect(result?.appendContext.split("\n")).toHaveLength(3);
  });
});
