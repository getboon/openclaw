/**
 * Session lifecycle state derivation tests.
 */
import { describe, expect, it, vi } from "vitest";
import { updateSessionStoreEntry } from "../config/sessions.js";
import {
  deriveGatewaySessionLifecycleSnapshot,
  derivePersistedSessionLifecyclePatch,
  isStaleLifecycleEventForSession,
  persistGatewaySessionLifecycleEvent,
} from "./session-lifecycle-state.js";
import { loadSessionEntry } from "./session-utils.js";

vi.mock("../config/sessions.js", () => ({
  updateSessionStoreEntry: vi.fn(),
}));

vi.mock("./session-utils.js", () => ({
  loadSessionEntry: vi.fn(),
}));

const THREAD_SESSION_KEY = "agent:main:99:thread-15004:thread:15004";
const SUBAGENT_SESSION_KEY = "agent:main:subagent:rand-printer";

type PersistedLifecycleInput = Parameters<typeof derivePersistedSessionLifecyclePatch>[0];
type PersistedLifecycleData = PersistedLifecycleInput["event"]["data"];
type PersistedLifecyclePatch = NonNullable<ReturnType<typeof derivePersistedSessionLifecyclePatch>>;
type PersistedLifecycleStatus = PersistedLifecyclePatch["status"];

type PersistedLifecycleCase = {
  name: string;
  data: PersistedLifecycleData;
  status: PersistedLifecycleStatus;
  abortedLastRun: boolean;
};

function terminalPatch(
  startedAt: number,
  endedAt: number,
  status: PersistedLifecycleStatus,
  abortedLastRun: boolean,
): PersistedLifecyclePatch {
  return {
    updatedAt: endedAt,
    status,
    startedAt,
    endedAt,
    runtimeMs: endedAt - startedAt,
    abortedLastRun,
  };
}

function expectPersistedLifecyclePatch(options: {
  sessionKey?: string;
  entry?: Partial<PersistedLifecycleInput["entry"]>;
  data: PersistedLifecycleData;
  runId?: string;
  lifecycleGeneration?: string;
  expected: ReturnType<typeof derivePersistedSessionLifecyclePatch>;
}): void {
  expect(
    derivePersistedSessionLifecyclePatch({
      sessionKey: options.sessionKey,
      entry: {
        updatedAt: 1_000,
        startedAt: 1_050,
        ...options.entry,
      },
      event: {
        ts: 2_000,
        runId: options.runId,
        lifecycleGeneration: options.lifecycleGeneration,
        data: options.data,
      },
    }),
  ).toEqual(options.expected);
}

describe("session lifecycle state", () => {
  it("treats a pre-reset run's lifecycle event as stale once the row's sessionId rotated (#88538)", () => {
    expect(
      isStaleLifecycleEventForSession({ owningSessionId: "old-id", currentSessionId: "new-id" }),
    ).toBe(true);
  });

  it("applies lifecycle events whose owning sessionId matches the current row", () => {
    expect(
      isStaleLifecycleEventForSession({ owningSessionId: "same-id", currentSessionId: "same-id" }),
    ).toBe(false);
  });

  it("does not guard when the owning sessionId is unknown (preserves legacy behavior)", () => {
    expect(
      isStaleLifecycleEventForSession({ owningSessionId: undefined, currentSessionId: "new-id" }),
    ).toBe(false);
  });

  it("reactivates completed sessions on lifecycle start", () => {
    expect(
      deriveGatewaySessionLifecycleSnapshot({
        session: {
          updatedAt: 500,
          status: "done",
          startedAt: 100,
          endedAt: 400,
          runtimeMs: 300,
          abortedLastRun: true,
        },
        event: {
          ts: 1_000,
          data: {
            phase: "start",
            startedAt: 900,
          },
        },
      }),
    ).toEqual({
      updatedAt: 900,
      status: "running",
      startedAt: 900,
      endedAt: undefined,
      runtimeMs: undefined,
      abortedLastRun: false,
    });
  });

  it("marks completed lifecycle end events as done with terminal timing", () => {
    expect(
      deriveGatewaySessionLifecycleSnapshot({
        session: {
          updatedAt: 1_000,
          status: "running",
          startedAt: 1_200,
        },
        event: {
          ts: 2_000,
          data: {
            phase: "end",
            startedAt: 1_200,
            endedAt: 1_900,
          },
        },
      }),
    ).toEqual({
      updatedAt: 1_900,
      status: "done",
      startedAt: 1_200,
      endedAt: 1_900,
      runtimeMs: 700,
      abortedLastRun: false,
    });
  });

  it("maps aborted stop reasons to killed", () => {
    expectPersistedLifecyclePatch({
      entry: { startedAt: 1_100 },
      data: {
        phase: "end",
        endedAt: 1_800,
        stopReason: "aborted",
      },
      expected: terminalPatch(1_100, 1_800, "killed", true),
    });
  });

  it.each([
    { existingFlag: true, expected: true },
    { existingFlag: false, expected: false },
  ])(
    "keeps abortedLastRun=$existingFlag when a blocked run ends aborted after a user stop",
    ({ existingFlag, expected }) => {
      expectPersistedLifecyclePatch({
        sessionKey: THREAD_SESSION_KEY,
        entry: { status: "running", abortedLastRun: existingFlag },
        data: {
          phase: "end",
          aborted: true,
          stopReason: "toolUse",
          livenessState: "blocked",
          endedAt: 1_800,
        },
        expected: terminalPatch(1_050, 1_800, "failed", expected),
      });
    },
  );

  it("keeps abortedLastRun when a run errors aborted after a user stop", () => {
    expectPersistedLifecyclePatch({
      sessionKey: THREAD_SESSION_KEY,
      entry: { status: "running", abortedLastRun: true },
      data: { phase: "error", aborted: true, error: "aborted", endedAt: 1_800 },
      expected: terminalPatch(1_050, 1_800, "failed", true),
    });
  });

  it.each([
    {
      name: "a timed-out subagent run",
      sessionKey: SUBAGENT_SESSION_KEY,
      data: { phase: "end", aborted: true, endedAt: 1_800 },
      status: "timeout",
    },
    {
      name: "a blocked aborted subagent run",
      sessionKey: SUBAGENT_SESSION_KEY,
      data: {
        phase: "end",
        aborted: true,
        stopReason: "toolUse",
        livenessState: "blocked",
        endedAt: 1_800,
      },
      status: "failed",
    },
    {
      name: "an aborted run without a session key",
      sessionKey: undefined,
      data: {
        phase: "end",
        aborted: true,
        stopReason: "toolUse",
        livenessState: "blocked",
        endedAt: 1_800,
      },
      status: "failed",
    },
  ] as const)("clears abortedLastRun for $name", ({ sessionKey, data, status }) => {
    expectPersistedLifecyclePatch({
      sessionKey,
      entry: { status: "running", abortedLastRun: true },
      data,
      expected: terminalPatch(1_050, 1_800, status, false),
    });
  });

  it("keeps abortedLastRun when persisting an aborted end for a parent thread session", async () => {
    vi.mocked(loadSessionEntry).mockReturnValue({
      storePath: "/tmp/sessions.json",
      canonicalKey: THREAD_SESSION_KEY,
      entry: { sessionId: "session-parent", updatedAt: 1_000 },
    } as unknown as ReturnType<typeof loadSessionEntry>);
    let patch: unknown;
    vi.mocked(updateSessionStoreEntry).mockImplementation(async (params) => {
      patch = await params.update({
        sessionId: "session-parent",
        updatedAt: 1_000,
        startedAt: 1_050,
        status: "running",
        abortedLastRun: true,
      });
      return null;
    });

    await persistGatewaySessionLifecycleEvent({
      sessionKey: THREAD_SESSION_KEY,
      event: {
        ts: 2_000,
        sessionId: "session-parent",
        data: {
          phase: "end",
          aborted: true,
          stopReason: "toolUse",
          livenessState: "blocked",
          endedAt: 1_800,
        },
      },
    });

    expect(patch).toEqual(terminalPatch(1_050, 1_800, "failed", true));
  });

  it("clears abortedLastRun when the last restart-marked run ends aborted and blocked", () => {
    expectPersistedLifecyclePatch({
      sessionKey: THREAD_SESSION_KEY,
      entry: {
        status: "running",
        abortedLastRun: true,
        restartRecoveryRuns: [{ runId: "restart-run", lifecycleGeneration: "pre-restart" }],
      },
      runId: "restart-run",
      lifecycleGeneration: "pre-restart",
      data: {
        phase: "end",
        aborted: true,
        stopReason: "toolUse",
        livenessState: "blocked",
        endedAt: 1_800,
      },
      expected: {
        ...terminalPatch(1_050, 1_800, "failed", false),
        restartRecoveryRuns: undefined,
      },
    });
  });

  it("clears abortedLastRun when a run ends normally after the flag was set", () => {
    expectPersistedLifecyclePatch({
      entry: { status: "running", abortedLastRun: true },
      data: { phase: "end", endedAt: 1_800 },
      expected: terminalPatch(1_050, 1_800, "done", false),
    });
  });

  it("persists restart terminal lifecycle when no recovery marker exists", () => {
    expectPersistedLifecyclePatch({
      entry: {
        status: "running",
        abortedLastRun: false,
      },
      data: {
        phase: "end",
        aborted: true,
        stopReason: "restart",
        endedAt: 1_800,
      },
      expected: terminalPatch(1_050, 1_800, "killed", true),
    });
  });

  it("preserves restart recovery state through late interrupted-run lifecycle events", () => {
    for (const data of [
      {
        phase: "end",
        aborted: true,
        stopReason: "restart",
      },
      {
        phase: "error",
        aborted: true,
        stopReason: "restart",
        error: "request aborted",
      },
    ] as const) {
      expectPersistedLifecyclePatch({
        entry: {
          status: "running",
          abortedLastRun: true,
          restartRecoveryRuns: [
            {
              runId: "restart-run",
              lifecycleGeneration: "pre-restart",
            },
          ],
        },
        runId: "restart-run",
        lifecycleGeneration: "pre-restart",
        data,
        expected: {},
      });
    }
  });

  it.each([
    {
      name: "user cancellation",
      data: {
        phase: "end",
        aborted: true,
        stopReason: "aborted",
        endedAt: 1_800,
      } as const,
      expected: {
        ...terminalPatch(1_050, 1_800, "killed", true),
        restartRecoveryRuns: undefined,
      },
    },
    {
      name: "provider timeout",
      data: {
        phase: "end",
        aborted: true,
        stopReason: "timeout",
        endedAt: 1_800,
      } as const,
      expected: {
        ...terminalPatch(1_050, 1_800, "timeout", false),
        restartRecoveryRuns: undefined,
      },
    },
  ])("persists $name terminal state despite a restart marker", ({ data, expected }) => {
    expectPersistedLifecyclePatch({
      entry: {
        status: "running",
        abortedLastRun: true,
        restartRecoveryRuns: [
          {
            runId: "restart-run",
            lifecycleGeneration: "pre-restart",
          },
        ],
      },
      runId: "restart-run",
      lifecycleGeneration: "pre-restart",
      data,
      expected,
    });
  });

  it("preserves restart recovery state through a delayed lifecycle start", () => {
    expectPersistedLifecyclePatch({
      entry: {
        status: "running",
        abortedLastRun: true,
        restartRecoveryRuns: [
          {
            runId: "restart-run",
            lifecycleGeneration: "pre-restart",
          },
        ],
      },
      runId: "restart-run",
      lifecycleGeneration: "pre-restart",
      data: {
        phase: "start",
        startedAt: 1_500,
      },
      expected: {},
    });
  });

  it("persists successful marked-run completion and removes its recovery marker", () => {
    expectPersistedLifecyclePatch({
      entry: {
        status: "running",
        abortedLastRun: true,
        restartRecoveryRuns: [
          {
            runId: "restart-run",
            lifecycleGeneration: "pre-restart",
          },
        ],
      },
      runId: "restart-run",
      lifecycleGeneration: "pre-restart",
      data: {
        phase: "end",
        endedAt: 1_800,
      },
      expected: {
        ...terminalPatch(1_050, 1_800, "done", false),
        restartRecoveryRuns: undefined,
      },
    });
  });

  it("keeps session recovery active while another marked run remains", () => {
    expectPersistedLifecyclePatch({
      entry: {
        status: "running",
        abortedLastRun: true,
        restartRecoveryRuns: [
          {
            runId: "completed-run",
            lifecycleGeneration: "pre-restart",
          },
          {
            runId: "interrupted-run",
            lifecycleGeneration: "pre-restart",
          },
        ],
      },
      runId: "completed-run",
      lifecycleGeneration: "pre-restart",
      data: {
        phase: "end",
        endedAt: 1_800,
      },
      expected: {
        restartRecoveryRuns: [
          {
            runId: "interrupted-run",
            lifecycleGeneration: "pre-restart",
          },
        ],
      },
    });
  });

  it("persists lifecycle events from a recovery run with a different run id", () => {
    expectPersistedLifecyclePatch({
      entry: {
        status: "running",
        abortedLastRun: true,
        restartRecoveryRuns: [
          {
            runId: "shared-idempotency-key",
            lifecycleGeneration: "pre-restart",
          },
        ],
      },
      runId: "shared-idempotency-key",
      lifecycleGeneration: "post-restart",
      data: {
        phase: "end",
        endedAt: 1_800,
      },
      expected: terminalPatch(1_050, 1_800, "done", false),
    });
  });

  it.each<PersistedLifecycleCase>([
    {
      name: "maps aborted lifecycle end events without stopReason to timeout",
      data: {
        phase: "end",
        endedAt: 1_550,
        aborted: true,
      },
      status: "timeout",
      abortedLastRun: false,
    },
    {
      name: "keeps provider hard timeouts stronger than rpc cancellation metadata",
      data: {
        phase: "end",
        aborted: true,
        stopReason: "rpc",
        timeoutPhase: "provider",
        providerStarted: true,
        endedAt: 1_550,
      },
      status: "timeout",
      abortedLastRun: false,
    },
    {
      name: "maps non-hard rpc lifecycle aborts to killed sessions",
      data: {
        phase: "end",
        aborted: true,
        stopReason: "rpc",
        timeoutPhase: "queue",
        providerStarted: false,
        endedAt: 1_550,
      },
      status: "killed",
      abortedLastRun: true,
    },
    {
      name: "maps provider timeout lifecycle errors to timed out sessions",
      data: {
        phase: "error",
        error: "provider request timed out",
        livenessState: "blocked",
        timeoutPhase: "provider",
        providerStarted: true,
        endedAt: 1_550,
      },
      status: "timeout",
      abortedLastRun: false,
    },
    {
      name: "maps provider timeout lifecycle end metadata to timed out sessions",
      data: {
        phase: "end",
        timeoutPhase: "provider",
        providerStarted: true,
        endedAt: 1_550,
      },
      status: "timeout",
      abortedLastRun: false,
    },
  ])("$name", ({ data, status, abortedLastRun }) => {
    expectPersistedLifecyclePatch({
      data,
      expected: terminalPatch(1_050, 1_550, status, abortedLastRun),
    });
  });
});
