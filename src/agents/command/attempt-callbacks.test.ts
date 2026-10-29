// Verifies the small lifecycle callback adapter used during agent attempts.
import { describe, expect, it } from "vitest";
import {
  createAgentAttemptLifecycleCallbacks,
  type AgentAttemptLifecycleState,
} from "./attempt-callbacks.js";

describe("createAgentAttemptLifecycleCallbacks", () => {
  it("tracks user-message persistence without closing over the agent command scope", () => {
    const state: AgentAttemptLifecycleState = {
      currentTurnUserMessagePersisted: false,
      lifecycleFinishing: false,
      lifecycleEnded: false,
    };
    const callbacks = createAgentAttemptLifecycleCallbacks(state);

    // The callback mutates only the shared lifecycle state object; it should not
    // need access to the wider runAgentAttempt closure.
    callbacks.onUserMessagePersisted?.({
      role: "user",
      content: "hello",
      timestamp: Date.now(),
    });

    expect(state.currentTurnUserMessagePersisted).toBe(true);
    expect(state.lifecycleEnded).toBe(false);
  });

  it("tracks terminal lifecycle phases", () => {
    const state = {
      currentTurnUserMessagePersisted: false,
      lifecycleFinishing: false,
      lifecycleEnded: false,
    };
    const callbacks = createAgentAttemptLifecycleCallbacks(state);

    callbacks.onAgentEvent({ stream: "lifecycle", data: { phase: "start" } });
    expect(state.lifecycleEnded).toBe(false);

    callbacks.onAgentEvent({ stream: "lifecycle", data: { phase: "end" } });
    expect(state.lifecycleEnded).toBe(true);
  });

  it("retains deferred lifecycle errors without marking the attempt terminal", () => {
    const state: AgentAttemptLifecycleState = {
      currentTurnUserMessagePersisted: false,
      lifecycleFinishing: false,
      lifecycleEnded: false,
    };
    const callbacks = createAgentAttemptLifecycleCallbacks(state);

    callbacks.onAgentEvent({
      stream: "lifecycle",
      data: { phase: "finishing", error: "provider failed" },
    });

    expect(state.lifecycleError).toBe("provider failed");
    expect(state.lifecycleFinishing).toBe(true);
    expect(state.lifecycleEnded).toBe(false);
  });

  it("clears the lifecycle error when a later finishing event has no error", () => {
    const state: AgentAttemptLifecycleState = {
      currentTurnUserMessagePersisted: false,
      lifecycleFinishing: false,
      lifecycleEnded: false,
    };
    const callbacks = createAgentAttemptLifecycleCallbacks(state);

    callbacks.onAgentEvent({
      stream: "lifecycle",
      data: {
        phase: "finishing",
        error: "Context overflow: prompt too large for the model (precheck).",
      },
    });
    callbacks.onAgentEvent({ stream: "lifecycle", data: { phase: "finishing" } });

    expect(state.lifecycleError).toBeUndefined();
    expect(state.lifecycleFinishing).toBe(true);
  });

  it("keeps the error from the last finishing event", () => {
    const state: AgentAttemptLifecycleState = {
      currentTurnUserMessagePersisted: false,
      lifecycleFinishing: false,
      lifecycleEnded: false,
    };
    const callbacks = createAgentAttemptLifecycleCallbacks(state);

    callbacks.onAgentEvent({ stream: "lifecycle", data: { phase: "finishing" } });
    callbacks.onAgentEvent({
      stream: "lifecycle",
      data: { phase: "finishing", error: "provider failed" },
    });

    expect(state.lifecycleError).toBe("provider failed");
  });

  it("keeps the error from an error phase", () => {
    const state: AgentAttemptLifecycleState = {
      currentTurnUserMessagePersisted: false,
      lifecycleFinishing: false,
      lifecycleEnded: false,
    };
    const callbacks = createAgentAttemptLifecycleCallbacks(state);

    callbacks.onAgentEvent({
      stream: "lifecycle",
      data: { phase: "error", error: "provider failed" },
    });

    expect(state.lifecycleError).toBe("provider failed");
    expect(state.lifecycleEnded).toBe(true);
  });
});
