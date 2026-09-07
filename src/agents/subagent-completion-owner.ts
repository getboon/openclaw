import { normalizeMessageChannel } from "../utils/message-channel.js";
import type { AgentInternalEvent } from "./internal-events.js";
import type { SubagentRunOutcome } from "./subagent-announce-output.js";

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
  outcome?: SubagentRunOutcome;
  startedAt?: number;
  endedAt?: number;
  label?: string;
  signal?: AbortSignal;
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
