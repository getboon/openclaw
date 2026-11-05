import { beforeEach, describe, expect, it, vi } from "vitest";
import { emitAgentEvent } from "../../infra/agent-events.js";
import { createAgentLifecycleTerminalBackstop } from "./agent-lifecycle-terminal.js";

vi.mock("../../infra/agent-events.js", () => ({
  emitAgentEvent: vi.fn(),
}));

const PRECHECK_ERROR = "Context overflow: prompt too large for the model (precheck).";

function createBackstop() {
  return createAgentLifecycleTerminalBackstop({
    runId: "run-1",
    getLifecycleGeneration: () => "gen-1",
    resolveAbortLifecycleFields: () => ({}),
  });
}

function finishing(data: Record<string, unknown> = {}) {
  return { stream: "lifecycle", data: { phase: "finishing", ...data } };
}

describe("createAgentLifecycleTerminalBackstop", () => {
  beforeEach(() => {
    vi.mocked(emitAgentEvent).mockClear();
  });

  it("clears the deferred error and metadata when a later finishing event recovers", () => {
    const backstop = createBackstop();

    backstop.note(finishing({ error: PRECHECK_ERROR, timeoutPhase: "x" }));
    backstop.note(finishing());

    expect(backstop.getDeferredError()).toBeUndefined();
    backstop.emit("end", { meta: {} });
    expect(emitAgentEvent).toHaveBeenCalledTimes(1);
    const data = vi.mocked(emitAgentEvent).mock.calls[0]?.[0].data;
    expect(data?.phase).toBe("end");
    expect(data).not.toHaveProperty("timeoutPhase");
  });

  it("keeps the error from the last finishing event", () => {
    const backstop = createBackstop();

    backstop.note(finishing());
    backstop.note(finishing({ error: "boom" }));

    expect(backstop.getDeferredError()).toBe("boom");
  });

  it("keeps a finishing error across later non-lifecycle events", () => {
    const backstop = createBackstop();

    backstop.note(finishing({ error: "boom" }));
    backstop.note({ stream: "tool", data: { phase: "finishing" } });

    expect(backstop.getDeferredError()).toBe("boom");
  });
});
