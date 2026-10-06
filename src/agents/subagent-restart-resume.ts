/**
 * Sub-agent restart-resume policy.
 *
 * Decides when a closing gateway keeps an interrupted child run unended so the
 * next boot resumes it in place. The task registry only skips its own terminal
 * patch for a held run; the run registry's finalize settles the task.
 */
import { getRuntimeConfig } from "../config/config.js";
import type { SessionEntry } from "../config/sessions/types.js";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import { isGatewayClosing } from "../process/command-queue.js";
import { isSubagentSessionKey } from "../routing/session-key.js";
import type { SubagentRunOutcome } from "./subagent-announce-output.js";
import type { SubagentRunRecord } from "./subagent-registry.types.js";
import { STALE_UNENDED_SUBAGENT_RUN_MS } from "./subagent-run-liveness.js";
import { resolveSubagentRunDeadlineMs } from "./subagent-run-timeout.js";

/**
 * Boot action for a restored run:
 * - "hold": orphan recovery owns it, so no boot wait;
 * - "mark-and-hold": a crash left it running, so set abortedLastRun first;
 * - "clear-mark": past its deadline, so the boot wait ends it as a timeout;
 * - "too-old": a crash left it running past the resume age bound, so today's restore;
 * - "none": today's restore.
 */
export type RestoredSubagentRunResumeAction =
  | "hold"
  | "mark-and-hold"
  | "clear-mark"
  | "too-old"
  | "none";

/** Finalize path of a sub-agent run end: an explicit kill, or the path that saw the run end. */
export type SubagentFinalizeCause = "explicit-kill" | "listener" | "wait" | "timeout" | "sweeper";

export function isSubagentRestartResumeEnabled(cfg: OpenClawConfig): boolean {
  return cfg.agents?.defaults?.subagents?.restartResume !== false;
}

export function isRestoredSubagentRunResumeCandidate(run: SubagentRunRecord): boolean {
  return (
    typeof run.endedAt !== "number" &&
    run.pauseReason !== "sessions_yield" &&
    isSubagentSessionKey(run.childSessionKey)
  );
}

export function resolveRestoredSubagentRunResumeAction(params: {
  run: SubagentRunRecord;
  session: SessionEntry | undefined;
  now: number;
  processStartedAt: number;
}): RestoredSubagentRunResumeAction {
  const { run, session } = params;
  if (!isRestoredSubagentRunResumeCandidate(run) || !session) {
    return "none";
  }
  if (isSubagentRunPastDeadline(run, params.now)) {
    return session.abortedLastRun === true ? "clear-mark" : "none";
  }
  if (session.abortedLastRun === true) {
    return "hold";
  }
  const crashed =
    session.status === "running" &&
    typeof session.updatedAt === "number" &&
    session.updatedAt < params.processStartedAt;
  if (!crashed) {
    return "none";
  }
  return resolveSubagentRunResumeAgeMs(run, params.now) < STALE_UNENDED_SUBAGENT_RUN_MS
    ? "mark-and-hold"
    : "too-old";
}

export function resolveSubagentRunResumeAgeMs(run: SubagentRunRecord, now: number): number {
  // Resume replaces the run with a fresh startedAt; sessionStartedAt carries over.
  return now - (run.sessionStartedAt ?? run.startedAt ?? run.createdAt);
}

export function isSubagentRunPastDeadline(
  run: Pick<SubagentRunRecord, "createdAt" | "startedAt" | "runTimeoutSeconds">,
  now: number,
): boolean {
  const deadlineMs = resolveSubagentRunDeadlineMs(run);
  return deadlineMs !== undefined && now >= deadlineMs;
}

export function shouldKeepSubagentRunUnendedOnGatewayClose(params: {
  childSessionKey: string | undefined;
  outcomeStatus: SubagentRunOutcome["status"];
  explicitKill: boolean;
  run?: Pick<SubagentRunRecord, "createdAt" | "startedAt" | "runTimeoutSeconds">;
  getConfig?: () => OpenClawConfig;
}): boolean {
  if (params.outcomeStatus === "ok" || params.explicitKill || !isGatewayClosing()) {
    return false;
  }
  if (params.run && isSubagentRunPastDeadline(params.run, Date.now())) {
    return false;
  }
  if (!isSubagentSessionKey(params.childSessionKey)) {
    return false;
  }
  return isSubagentRestartResumeEnabled((params.getConfig ?? getRuntimeConfig)());
}
