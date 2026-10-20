/**
 * Subagent registry record types.
 *
 * Defines execution, completion, delivery, pending-delivery, and attachment state stored for child runs.
 */
import type { AgentDecisionTrace } from "../auto-reply/reply-payload.js";
import type { DeliveryContext } from "../utils/delivery-context.types.js";
import type { SubagentRunOutcome } from "./subagent-announce-output.js";
import type { SubagentLifecycleEndedReason } from "./subagent-lifecycle-events.js";
import type { SpawnSubagentMode } from "./subagent-spawn.types.js";

export type PendingFinalDeliveryPayload = {
  requesterSessionKey: string;
  requesterOrigin?: DeliveryContext;
  requesterDisplayKey: string;
  childSessionKey: string;
  childRunId: string;
  task: string;
  label?: string;
  startedAt?: number;
  endedAt?: number;
  outcome?: SubagentRunOutcome;
  expectsCompletionMessage?: boolean;
  spawnMode?: SpawnSubagentMode;
  frozenResultText?: string | null;
  fallbackFrozenResultText?: string | null;
  /** Mirrors SubagentCompletionState.resultAuditTrace. */
  frozenAuditTrace?: AgentDecisionTrace;
  wakeOnDescendantSettle?: boolean;
};

export type SubagentExecutionState = {
  status: "running" | "interrupted" | "terminal";
  startedAt?: number;
  endedAt?: number;
  outcome?: SubagentRunOutcome;
  interruptedAt?: number;
  interruptionReason?: "gateway-restart" | "lost-execution-context";
  transcriptFile?: string;
};

export type SubagentCompletionState = {
  required: boolean;
  resultText?: string | null;
  capturedAt?: number;
  fallbackResultText?: string | null;
  fallbackCapturedAt?: number;
  /**
   * The subagent's own already-computed audit trace, recorded directly
   * (not frozen from a transcript read — that's impossible, since this
   * value doesn't exist yet when the transcript entry is written) by
   * recordSubagentReplyAuditTrace whenever the child computes any reply.
   * Additive — absent until that write happens, absent
   * forever for a child that never got to reply (error/orphan/timeout).
   */
  resultAuditTrace?: AgentDecisionTrace;
};

export type SubagentCompletionDeliveryState = {
  status:
    | "not_required"
    | "pending"
    | "in_progress"
    | "delivered"
    | "failed"
    | "suspended"
    | "discarded";
  payload?: PendingFinalDeliveryPayload;
  createdAt?: number;
  enqueuedAt?: number;
  deliveredAt?: number;
  announcedAt?: number;
  ownerChannel?: string;
  lastAttemptAt?: number;
  attemptCount?: number;
  lastError?: string | null;
  steeringLeaseId?: string;
  steeringLeasedAt?: number;
  steeringInjectedAt?: number;
  suspendedAt?: number;
  suspendedReason?: SubagentAnnounceGiveUpReason;
  discardedAt?: number;
  discardReason?: "expired" | "pressure-pruned";
  discardedPayloadSummary?: {
    requesterSessionKey?: string;
    childSessionKey?: string;
    childRunId?: string;
    endedAt?: number;
    status?: string;
    lastError?: string | null;
  };
  lastDropReason?:
    | "queue_cap"
    | "parent_run_ended"
    | "sink_unavailable"
    | "dedupe"
    | "waiting_for_requester_turn"
    | "subagent_no_output"
    | "owner_terminal";
};

export type SubagentAnnounceGiveUpReason =
  | "retry-limit"
  | "expiry"
  | "subagent_no_output"
  | "owner_terminal";

export type SubagentRunRecord = {
  runId: string;
  childSessionKey: string;
  controllerSessionKey?: string;
  requesterSessionKey: string;
  requesterOrigin?: DeliveryContext;
  requesterDisplayKey: string;
  task: string;
  taskName?: string;
  cleanup: "delete" | "keep";
  label?: string;
  model?: string;
  agentDir?: string;
  workspaceDir?: string;
  runTimeoutSeconds?: number;
  spawnMode?: SpawnSubagentMode;
  createdAt: number;
  startedAt?: number;
  sessionStartedAt?: number;
  accumulatedRuntimeMs?: number;
  endedAt?: number;
  outcome?: SubagentRunOutcome;
  archiveAtMs?: number;
  cleanupCompletedAt?: number;
  cleanupHandled?: boolean;
  suppressAnnounceReason?: "steer-restart" | "killed";
  expectsCompletionMessage?: boolean;
  endedReason?: SubagentLifecycleEndedReason;
  pauseReason?: "sessions_yield";
  wakeOnDescendantSettle?: boolean;
  execution?: SubagentExecutionState;
  completion?: SubagentCompletionState;
  /** Set after the subagent_ended hook has been emitted successfully once. */
  endedHookEmittedAt?: number;
  /** Set after cleanupBrowserSessionsForLifecycleEnd has been dispatched once. */
  browserCleanupDispatchedAt?: number;
  /** Durable outbox marker for parent/external completion delivery. */
  delivery?: SubagentCompletionDeliveryState;
  attachmentsDir?: string;
  attachmentsRootDir?: string;
  retainAttachmentsOnKeep?: boolean;
};
