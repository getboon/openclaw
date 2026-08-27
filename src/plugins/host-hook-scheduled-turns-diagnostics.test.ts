// Covers diagnostic logging for silent-failure gates in schedulePluginSessionTurn
// and unschedulePluginSessionTurnsByTag -- these previously returned undefined /
// a success-shaped result with no signal at all.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CronServiceContract } from "../cron/service-contract.js";

const mockedLogger = vi.hoisted(() => ({
  info: vi.fn<(msg: string) => void>(),
  warn: vi.fn<(msg: string) => void>(),
  error: vi.fn<(msg: string) => void>(),
  debug: vi.fn<(msg: string) => void>(),
  child: vi.fn(() => mockedLogger),
}));

vi.mock("../logging/subsystem.js", () => ({
  createSubsystemLogger: () => mockedLogger,
}));

import { clearPluginHostRuntimeState } from "./host-hook-runtime.js";
import {
  schedulePluginSessionTurn,
  unschedulePluginSessionTurnsByTag,
} from "./host-hook-scheduled-turns.js";

function createStubCron(overrides: Partial<CronServiceContract> = {}): CronServiceContract {
  return {
    start: vi.fn(async () => undefined),
    stop: vi.fn(),
    status: vi.fn(async () => ({}) as never),
    list: vi.fn(async () => ({ jobs: [] }) as never),
    listPage: vi.fn(async () => ({ jobs: [], nextOffset: undefined }) as never),
    add: vi.fn(async () => ({ id: "job-1" }) as never),
    update: vi.fn(async () => ({}) as never),
    remove: vi.fn(async () => ({ removed: true }) as never),
    run: vi.fn(async () => ({}) as never),
    enqueueRun: vi.fn(async () => ({}) as never),
    getJob: vi.fn(() => undefined),
    readJob: vi.fn(async () => undefined),
    getDefaultAgentId: vi.fn(() => undefined),
    wake: vi.fn(async () => ({}) as never),
    ...overrides,
  } as CronServiceContract;
}

const BASE_SCHEDULE = { sessionKey: "agent:main:main", message: "wake", delayMs: 1_000 } as const;

describe("schedulePluginSessionTurn diagnostics", () => {
  beforeEach(() => {
    mockedLogger.warn.mockClear();
  });
  afterEach(() => {
    clearPluginHostRuntimeState();
  });

  it("logs a warning when the calling plugin is not bundled", async () => {
    const result = await schedulePluginSessionTurn({
      pluginId: "not-bundled-plugin",
      origin: "external",
      schedule: BASE_SCHEDULE,
      cron: createStubCron(),
    });
    expect(result).toBeUndefined();
    expect(mockedLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining("only bundled plugins may schedule durable session turns"),
    );
  });

  it("logs a warning when sessionKey is missing", async () => {
    const result = await schedulePluginSessionTurn({
      pluginId: "test-plugin",
      origin: "bundled",
      schedule: { ...BASE_SCHEDULE, sessionKey: "" },
      cron: createStubCron(),
    });
    expect(result).toBeUndefined();
    expect(mockedLogger.warn).toHaveBeenCalledWith(expect.stringContaining("missing sessionKey"));
  });

  it("logs a warning when message is missing", async () => {
    const result = await schedulePluginSessionTurn({
      pluginId: "test-plugin",
      origin: "bundled",
      schedule: { ...BASE_SCHEDULE, message: "" },
      cron: createStubCron(),
    });
    expect(result).toBeUndefined();
    expect(mockedLogger.warn).toHaveBeenCalledWith(expect.stringContaining("missing message"));
  });

  it("logs a warning when the schedule cannot be resolved", async () => {
    const result = await schedulePluginSessionTurn({
      pluginId: "test-plugin",
      origin: "bundled",
      schedule: { ...BASE_SCHEDULE, delayMs: -1 },
      cron: createStubCron(),
    });
    expect(result).toBeUndefined();
    expect(mockedLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining("unresolvable schedule"),
    );
  });

  it("logs a warning when the plugin record is not loaded in the active registry", async () => {
    // shouldCommit is the caller's own liveness check on its plugin record;
    // this gate fires whenever the caller reports itself no longer loaded.
    const result = await schedulePluginSessionTurn({
      pluginId: "test-plugin",
      origin: "bundled",
      schedule: BASE_SCHEDULE,
      shouldCommit: () => false,
      cron: createStubCron(),
    });
    expect(result).toBeUndefined();
    expect(mockedLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining("plugin record is not loaded in the active registry"),
    );
  });

  it("logs a warning when cron.add returns no job id", async () => {
    const result = await schedulePluginSessionTurn({
      pluginId: "test-plugin",
      origin: "bundled",
      schedule: BASE_SCHEDULE,
      cron: createStubCron({ add: vi.fn(async () => ({ id: "" }) as never) }),
    });
    expect(result).toBeUndefined();
    expect(mockedLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining("cron.add returned no job id"),
    );
  });

  it("does not warn on a successful schedule", async () => {
    const result = await schedulePluginSessionTurn({
      pluginId: "test-plugin",
      origin: "bundled",
      schedule: BASE_SCHEDULE,
      cron: createStubCron(),
    });
    expect(result).toBeDefined();
    expect(mockedLogger.warn).not.toHaveBeenCalled();
  });
});

describe("unschedulePluginSessionTurnsByTag diagnostics", () => {
  beforeEach(() => {
    mockedLogger.warn.mockClear();
  });
  afterEach(() => {
    clearPluginHostRuntimeState();
  });

  it("logs a warning when the calling plugin is not bundled", async () => {
    const result = await unschedulePluginSessionTurnsByTag({
      pluginId: "not-bundled-plugin",
      origin: "external",
      cron: createStubCron(),
      request: { sessionKey: "agent:main:main", tag: "site:example.com" },
    });
    expect(result).toEqual({ removed: 0, failed: 0 });
    expect(mockedLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining("only bundled plugins may manage durable session turns"),
    );
  });
});
