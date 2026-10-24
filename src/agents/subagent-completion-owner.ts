import { normalizeMessageChannel } from "../utils/message-channel-normalize.js";
import type { AgentInternalEvent } from "./internal-events.js";
import type { UsageAttribution } from "./usage-attribution.js";

// Structural copy of SubagentRunOutcome: importing it from the announce output
// module would route this leaf through the gateway barrel and form an import cycle.
export type SubagentCompletionOutcome = {
  status: "ok" | "error" | "timeout" | "unknown";
  error?: string;
  startedAt?: number;
  endedAt?: number;
  elapsedMs?: number;
};

export type SubagentCompletionRoute = {
  channel: string;
  accountId?: string;
  to: string;
  threadId?: string | number;
};

export type SubagentCompletionRequest = {
  completionId: string;
  childSessionKey: string;
  childRunId: string;
  requesterSessionKey: string;
  route: SubagentCompletionRoute;
  event: AgentInternalEvent;
  promptText: string;
  outcome?: SubagentCompletionOutcome;
  startedAt?: number;
  endedAt?: number;
  label?: string;
  signal?: AbortSignal;
  /**
   * True when the owner will not be called again for this completion, even if
   * this attempt fails retryably. A suspended completion (cleanup "keep",
   * outcome ok) can still reach the requester via steering on its next turn.
   * Computed before the call, so a late expiry or new pending descendants can
   * still change the real outcome.
   */
  finalAttempt?: boolean;
  /**
   * Billing-only user the requester's completion turn is attributed to. That turn
   * has no inbound sender, so owners set it on the turn context (`UsageAttribution`)
   * rather than as sender identity; tool policy and auth stay unchanged.
   */
  usageAttribution?: UsageAttribution;
};

export type SubagentCompletionResult =
  | { status: "delivered"; deliveredAt?: number }
  | { status: "pending"; error?: string }
  | { status: "not_handled" }
  | { status: "failed"; retryable: boolean; error: string };

export type SubagentCompletionOwner = {
  channel: string;
  accepts: (request: SubagentCompletionRequest) => boolean | Promise<boolean>;
  deliver: (request: SubagentCompletionRequest) => Promise<SubagentCompletionResult>;
};

const owners = new Map<string, SubagentCompletionOwner>();

export function registerSubagentCompletionOwner(owner: SubagentCompletionOwner): {
  dispose: () => void;
} {
  const channel = normalizeMessageChannel(owner.channel);
  if (!channel) {
    throw new Error("Subagent completion owner channel is required");
  }
  if (owners.has(channel)) {
    throw new Error(`Subagent completion owner already registered for ${channel}`);
  }
  owners.set(channel, owner);
  return {
    dispose: () => {
      if (owners.get(channel) === owner) {
        owners.delete(channel);
      }
    },
  };
}

export function getSubagentCompletionOwner(
  channel: string | undefined,
): SubagentCompletionOwner | undefined {
  const normalized = normalizeMessageChannel(channel);
  return normalized ? owners.get(normalized) : undefined;
}

export function resetSubagentCompletionOwnersForTest(): void {
  owners.clear();
}
