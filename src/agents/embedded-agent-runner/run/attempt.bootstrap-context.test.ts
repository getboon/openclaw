// Coverage for attempt bootstrap ownership and context path remapping.
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  isPrimaryBootstrapRun,
  remapInjectedContextFilesToWorkspace,
} from "./attempt.bootstrap-context.js";
import {
  cleanupTempPaths,
  createContextEngineAttemptRunner,
  createContextEngineBootstrapAndAssemble,
  getHoisted,
  preloadRunEmbeddedAttemptForTests,
  resetEmbeddedAttemptHarness,
} from "./attempt.spawn-workspace.test-support.js";

describe("isPrimaryBootstrapRun", () => {
  it("treats regular sessions as primary bootstrap runs", () => {
    expect(isPrimaryBootstrapRun("agent:main:main")).toBe(true);
  });

  it("suppresses bootstrap ownership for subagent and ACP/helper sessions", () => {
    // Only the primary session owns bootstrap context; helper sessions inherit
    // context through their parent flow.
    expect(isPrimaryBootstrapRun("agent:main:subagent:worker")).toBe(false);
    expect(isPrimaryBootstrapRun("agent:main:acp:worker")).toBe(false);
  });
});

describe("remapInjectedContextFilesToWorkspace", () => {
  it("rewrites injected file paths onto the effective workspace when the tool root changes", () => {
    // Spawned/sandboxed workspaces preserve relative context file locations while
    // leaving outside-workspace references untouched.
    expect(
      remapInjectedContextFilesToWorkspace({
        files: [
          {
            path: "/real/workspace/AGENTS.md",
            content: "agents",
          },
          {
            path: "/real/workspace/nested/TOOLS.md",
            content: "tools",
          },
          {
            path: "/real/workspace/..context/USER.md",
            content: "dot-prefixed context",
          },
          {
            path: "/outside/README.md",
            content: "outside",
          },
        ],
        sourceWorkspaceDir: "/real/workspace",
        targetWorkspaceDir: "/sandbox/workspace",
      }),
    ).toEqual([
      {
        path: "/sandbox/workspace/AGENTS.md",
        content: "agents",
      },
      {
        path: "/sandbox/workspace/nested/TOOLS.md",
        content: "tools",
      },
      {
        path: "/sandbox/workspace/..context/USER.md",
        content: "dot-prefixed context",
      },
      {
        path: "/outside/README.md",
        content: "outside",
      },
    ]);
  });
});

describe("runEmbeddedAttempt bootstrap sender identity", () => {
  const hoisted = getHoisted();
  const tempPaths: string[] = [];

  beforeAll(async () => {
    await preloadRunEmbeddedAttemptForTests();
  });

  beforeEach(() => {
    resetEmbeddedAttemptHarness();
  });

  afterEach(async () => {
    await cleanupTempPaths(tempPaths);
    tempPaths.length = 0;
  });

  it("resolves USER.md under the caller's senderId when one is provided", async () => {
    // The real turn's senderId must reach bootstrap file resolution so
    // MEMORY.md/USER.md resolve under that sender's identity path instead of
    // the shared workspace root (ENG-21047).
    await createContextEngineAttemptRunner({
      contextEngine: createContextEngineBootstrapAndAssemble(),
      sessionKey: "agent:main:telegram:dm:alice",
      tempPaths,
      attemptOverrides: {
        senderId: "alice",
      },
    });

    const bootstrapCall = hoisted.resolveBootstrapFilesForRunMock.mock.calls[0]?.[0] as
      | { senderId?: string | null }
      | undefined;
    expect(bootstrapCall?.senderId).toBe("alice");
  });

  it("resolves USER.md at the workspace root when senderId is absent (back-compat)", async () => {
    await createContextEngineAttemptRunner({
      contextEngine: createContextEngineBootstrapAndAssemble(),
      sessionKey: "agent:main:telegram:dm:alice",
      tempPaths,
    });

    const bootstrapCall = hoisted.resolveBootstrapFilesForRunMock.mock.calls[0]?.[0] as
      | { senderId?: string | null }
      | undefined;
    expect(bootstrapCall?.senderId).toBeUndefined();
  });
});
