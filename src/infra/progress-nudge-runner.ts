// Emits proactive "still working" progress nudges during long-running agent
// turns so a long batch/analysis does not go silent, plus a single failure
// nudge when a run that had gone long fails or stalls. Channel-agnostic: it
// reuses the heartbeat delivery path (target:"last" → the user's active
// channel), the reply-run registry (authoritative active-turn + start time +
// terminal signal), and the agent-event bus (the "working on X" content).
//
// Structurally mirrors startHeartbeatRunner: a self-rearming setTimeout loop
// with per-sessionKey state, unref(), abortSignal, and an injectable deps
// surface for tests. It is deliberately NOT wired into the run lifecycle's
// control flow — it observes the registry, so it can never leak a timer onto
// the abort/restart paths.
import { resolveDefaultAgentId } from "../agents/agent-scope.js";
import { replaceGenericExternalRunFailureText } from "../auto-reply/reply/agent-runner-failure-copy.js";
import {
  listActiveReplyRunSessionKeys,
  onReplyRunTerminal,
  replyRunRegistry,
  resolveActiveReplyRunStartedAt,
  resolveActiveReplyRunThreadId,
  type ReplyRunTerminalEvent,
} from "../auto-reply/reply/reply-run-registry.js";
import { sendDurableMessageBatch } from "../channels/message/runtime.js";
import { dispatchChannelMessageAction } from "../channels/plugins/message-action-dispatch.js";
import { getRuntimeConfig } from "../config/config.js";
import { resolveStorePath } from "../config/sessions/paths.js";
import { loadSessionStore } from "../config/sessions/store-load.js";
import type { SessionEntry } from "../config/sessions/types.js";
import type { AgentDefaultsConfig } from "../config/types.agent-defaults.js";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { resolveAgentIdFromSessionKey } from "../routing/session-key.js";
import { defaultRuntime, type RuntimeEnv } from "../runtime.js";
import { MAX_SAFE_TIMEOUT_DELAY_MS, resolveSafeTimeoutDelayMs } from "../utils/timer-delay.js";
import { getAgentRunContext, onAgentEvent, type AgentEventPayload } from "./agent-events.js";
import { isWithinActiveHours } from "./heartbeat-active-hours.js";
import { buildOutboundSessionContext } from "./outbound/session-context.js";
import { resolveHeartbeatDeliveryTargetWithSessionRoute } from "./outbound/targets.js";

const log = createSubsystemLogger("gateway/progress-nudge");

export const DEFAULT_PROGRESS_NUDGE_THRESHOLD_SECONDS = 45;
export const DEFAULT_PROGRESS_NUDGE_INTERVAL_SECONDS = 30;
export const DEFAULT_PROGRESS_NUDGE_MAX_NUDGES = 3;

type ProgressNudgeConfig = NonNullable<AgentDefaultsConfig["progressNudge"]>;

/** Fully-resolved settings after applying defaults. */
type ResolvedProgressNudgeConfig = {
  enabled: boolean;
  thresholdMs: number;
  intervalMs: number;
  maxNudges: number;
  target: "last" | "none";
  activeHours: ProgressNudgeConfig["activeHours"];
};

/** Per-sessionKey nudge bookkeeping — a delivery concern, kept out of the registry. */
type NudgeState = {
  lastNudgeSentAtMs?: number;
  nudgeCount: number;
  errorNudgeSent: boolean;
  anchorMessageId?: string;
  anchorRetainUntilMs?: number;
  runStartedAtMs?: number;
  /** Latest tool/item progress text seen on the agent-event bus for this session. */
  progressText?: string;
};

export type ProgressNudgeRunner = {
  stop: () => void;
  updateConfig: (cfg: OpenClawConfig) => void;
};

/** Injectable seams so tests can drive the loop with fake timers and spies. */
export type ProgressNudgeDeps = {
  now?: () => number;
  listActiveSessionKeys?: () => string[];
  resolveStartedAt?: (sessionKey: string) => number | undefined;
  resolveThreadId?: (sessionKey: string) => string | number | undefined;
  getRunPhase?: (sessionKey: string) => string | undefined;
  resolveActiveSessionId?: (sessionKey: string) => string | undefined;
  resolveRunSessionId?: (runId: string) => string | undefined;
  subscribeAgentEvents?: (listener: (evt: AgentEventPayload) => void) => () => void;
  subscribeTerminal?: (listener: (evt: ReplyRunTerminalEvent) => void) => () => void;
  resolveDeliveryTarget?: typeof resolveHeartbeatDeliveryTargetWithSessionRoute;
  sendMessage?: typeof sendDurableMessageBatch;
  editMessage?: (params: {
    cfg: OpenClawConfig;
    channel: string;
    to: string;
    accountId?: string | null;
    threadId?: string | number;
    messageId: string;
    text: string;
    sessionKey: string;
    agentId: string;
  }) => Promise<boolean>;
};

function resolveProgressNudgeConfig(cfg: OpenClawConfig): ResolvedProgressNudgeConfig {
  const raw = cfg.agents?.defaults?.progressNudge;
  const thresholdSeconds = raw?.thresholdSeconds ?? DEFAULT_PROGRESS_NUDGE_THRESHOLD_SECONDS;
  const intervalSeconds = raw?.intervalSeconds ?? DEFAULT_PROGRESS_NUDGE_INTERVAL_SECONDS;
  const maxNudges = raw?.maxNudges ?? DEFAULT_PROGRESS_NUDGE_MAX_NUDGES;
  return {
    enabled: raw?.enabled === true,
    thresholdMs: thresholdSeconds * 1000,
    intervalMs: intervalSeconds * 1000,
    maxNudges,
    target: raw?.target ?? "last",
    activeHours: raw?.activeHours,
  };
}

/**
 * Poll cadence. We poll finer than the threshold/interval gates so a nudge
 * lands close to when it's actually due (a coarse poll equal to the interval
 * would round the first nudge up to a full interval past the threshold).
 * Capped at 15s for responsiveness, floored at 5s to avoid busy-spinning, and
 * never coarser than the smaller of threshold/interval for tight configs.
 */
const PROGRESS_NUDGE_MAX_TICK_MS = 15_000;
const PROGRESS_NUDGE_MIN_TICK_MS = 5_000;
const PROGRESS_NUDGE_ANCHOR_RETENTION_MS = 10 * 60_000;
function resolveTickMs(resolved: ResolvedProgressNudgeConfig): number {
  const bound = Math.min(resolved.thresholdMs, resolved.intervalMs, PROGRESS_NUDGE_MAX_TICK_MS);
  return Math.max(PROGRESS_NUDGE_MIN_TICK_MS, bound);
}

function renderProgressText(progressText: string | undefined): string {
  const trimmed = progressText?.trim();
  if (trimmed) {
    return `Still working on ${trimmed}…`;
  }
  return "Still working on your request…";
}

function renderErrorText(): string {
  // Reuse the existing external-run-failure phrasing, then append a next step so
  // a long-running turn that failed never just goes silent.
  const { text } = replaceGenericExternalRunFailureText(
    "The run hit an error before it could finish.",
  );
  return `${text}\n\nYou can send the request again, or narrow it into a smaller batch.`;
}

function loadSessionEntryForKey(
  cfg: OpenClawConfig,
  agentId: string,
  sessionKey: string,
): SessionEntry | undefined {
  try {
    const storePath = resolveStorePath(cfg.session?.store, { agentId });
    const store = loadSessionStore(storePath);
    return store[sessionKey];
  } catch {
    return undefined;
  }
}

export function startProgressNudgeRunner(opts: {
  cfg?: OpenClawConfig;
  runtime?: RuntimeEnv;
  abortSignal?: AbortSignal;
  deps?: ProgressNudgeDeps;
}): ProgressNudgeRunner {
  const deps = opts.deps ?? {};
  const now = deps.now ?? (() => Date.now());
  const listActiveSessionKeys = deps.listActiveSessionKeys ?? listActiveReplyRunSessionKeys;
  const resolveStartedAt = deps.resolveStartedAt ?? resolveActiveReplyRunStartedAt;
  const resolveThreadId = deps.resolveThreadId ?? resolveActiveReplyRunThreadId;
  const getRunPhase =
    deps.getRunPhase ?? ((sessionKey: string) => replyRunRegistry.get(sessionKey)?.phase);
  const resolveActiveSessionId =
    deps.resolveActiveSessionId ??
    ((sessionKey: string) => replyRunRegistry.resolveSessionId(sessionKey));
  const resolveRunSessionId =
    deps.resolveRunSessionId ?? ((runId: string) => getAgentRunContext(runId)?.sessionId);
  const subscribeAgentEvents = deps.subscribeAgentEvents ?? onAgentEvent;
  const subscribeTerminal = deps.subscribeTerminal ?? onReplyRunTerminal;
  const resolveDeliveryTarget =
    deps.resolveDeliveryTarget ?? resolveHeartbeatDeliveryTargetWithSessionRoute;
  const sendMessage = deps.sendMessage ?? sendDurableMessageBatch;
  const editMessage =
    deps.editMessage ??
    (async (params) => {
      const result = await dispatchChannelMessageAction({
        cfg: params.cfg,
        channel: params.channel as never,
        action: "edit",
        params: {
          channelId: params.to,
          to: params.to,
          threadId: params.threadId,
          messageId: params.messageId,
          content: params.text,
          text: params.text,
          message: params.text,
        },
        accountId: params.accountId,
        sessionKey: params.sessionKey,
        agentId: params.agentId,
      });
      return result !== null;
    });

  const state = {
    cfg: opts.cfg ?? getRuntimeConfig(),
    runtime: opts.runtime ?? defaultRuntime,
    resolved: resolveProgressNudgeConfig(opts.cfg ?? getRuntimeConfig()),
    nudges: new Map<string, NudgeState>(),
    timer: null as NodeJS.Timeout | null,
    stopped: false,
  };
  let overflowWarned = false;

  const getOrCreateNudgeState = (
    sessionKey: string,
    runStartedAtMs?: number,
    nowMs = now(),
  ): NudgeState => {
    let entry = state.nudges.get(sessionKey);
    if (!entry) {
      entry = { nudgeCount: 0, errorNudgeSent: false, runStartedAtMs };
      state.nudges.set(sessionKey, entry);
      return entry;
    }
    if (entry.anchorRetainUntilMs !== undefined && nowMs >= entry.anchorRetainUntilMs) {
      entry.anchorMessageId = undefined;
      entry.anchorRetainUntilMs = undefined;
    }
    if (runStartedAtMs !== undefined) {
      if (entry.runStartedAtMs !== undefined && entry.runStartedAtMs !== runStartedAtMs) {
        entry.lastNudgeSentAtMs = undefined;
        entry.nudgeCount = 0;
        entry.errorNudgeSent = false;
        entry.progressText = undefined;
      }
      entry.runStartedAtMs = runStartedAtMs;
    }
    return entry;
  };

  const deliverNudge = async (
    sessionKey: string,
    text: string,
    threadIdOverride?: string | number,
    nudgeState?: NudgeState,
  ): Promise<void> => {
    const agentId = resolveAgentIdFromSessionKey(sessionKey) || resolveDefaultAgentId(state.cfg);
    const entry = loadSessionEntryForKey(state.cfg, agentId, sessionKey);
    const delivery = await resolveDeliveryTarget({
      cfg: state.cfg,
      agentId,
      entry,
      heartbeat: { target: "last" },
      currentSessionKey: sessionKey,
    });
    if (delivery.channel === "none" || !delivery.to) {
      log.info("progress-nudge: no deliverable target", { sessionKey, reason: delivery.reason });
      return;
    }
    // A terminal nudge passes the run's route explicitly (the registry no longer
    // has the run); the in-turn path resolves it live.
    const threadId = threadIdOverride ?? resolveThreadId(sessionKey) ?? delivery.threadId;
    if (nudgeState?.anchorMessageId) {
      try {
        const edited = await editMessage({
          cfg: state.cfg,
          channel: delivery.channel,
          to: delivery.to,
          accountId: delivery.accountId,
          threadId,
          messageId: nudgeState.anchorMessageId,
          text,
          sessionKey,
          agentId,
        });
        if (edited) {
          log.info("progress-nudge: delivered", {
            sessionKey,
            mode: "edit",
            channel: delivery.channel,
            threadId,
            messageId: nudgeState.anchorMessageId,
            nudgeCount: nudgeState.nudgeCount,
          });
          return;
        }
      } catch (err) {
        log.debug("progress-nudge: anchor edit failed; sending a replacement", {
          sessionKey,
          error: err instanceof Error ? err.message : String(err),
        });
      }
      nudgeState.anchorMessageId = undefined;
    }
    const outboundSession = buildOutboundSessionContext({
      cfg: state.cfg,
      agentId,
      sessionKey,
    });
    const result = await sendMessage({
      cfg: state.cfg,
      channel: delivery.channel,
      to: delivery.to,
      accountId: delivery.accountId,
      threadId,
      payloads: [{ text }],
      session: outboundSession,
    });
    if (result.status === "failed" || result.status === "partial_failed") {
      log.warn("progress-nudge: delivery failed", { sessionKey, channel: delivery.channel });
      return;
    }
    const messageId =
      result.receipt?.primaryPlatformMessageId ??
      result.results.find((item) => typeof item.messageId === "string")?.messageId;
    if (messageId && nudgeState) {
      nudgeState.anchorMessageId = messageId;
    }
    // "suppressed" means nothing actually went out (e.g. a silent-reply policy
    // hook cancelled it) — only a real "sent" outcome is a delivery to log.
    if (result.status === "sent") {
      log.info("progress-nudge: delivered", {
        sessionKey,
        mode: "send",
        channel: delivery.channel,
        threadId,
        messageId,
        nudgeCount: nudgeState?.nudgeCount,
      });
    }
  };

  const maybeNudgeSession = async (sessionKey: string, nowMs: number): Promise<void> => {
    const startedAt = resolveStartedAt(sessionKey);
    if (startedAt === undefined) {
      return;
    }
    const elapsed = nowMs - startedAt;
    // Fast-task suppression: nothing fires before the threshold.
    if (elapsed < state.resolved.thresholdMs) {
      return;
    }
    const entry = getOrCreateNudgeState(sessionKey, startedAt, nowMs);
    if (entry.nudgeCount >= state.resolved.maxNudges) {
      return;
    }
    // Interval gate between successive "still working" nudges.
    if (
      entry.lastNudgeSentAtMs !== undefined &&
      nowMs - entry.lastNudgeSentAtMs < state.resolved.intervalMs
    ) {
      return;
    }
    // Active-hours gate (optional): stay quiet outside the window.
    if (!isWithinActiveHours(state.cfg, { activeHours: state.resolved.activeHours }, nowMs)) {
      return;
    }
    // Final-reply-race guard: skip only if the run reached a TERMINAL phase
    // between the poll snapshot and here — the real reply/failure is landing, so
    // a nudge would be redundant or race the terminal handler. Non-terminal
    // phases (queued/preflight_compacting/memory_flushing/running) are all
    // legitimate long waits the user should still be nudged through — those are
    // exactly the silent gaps this feature targets.
    const phase = getRunPhase(sessionKey);
    if (phase === "completed" || phase === "failed" || phase === "aborted") {
      return;
    }
    entry.lastNudgeSentAtMs = nowMs;
    entry.nudgeCount += 1;
    await deliverNudge(sessionKey, renderProgressText(entry.progressText), undefined, entry);
  };

  const tick = async (): Promise<void> => {
    if (state.stopped || !state.resolved.enabled || state.resolved.target === "none") {
      return;
    }
    const nowMs = now();
    const activeKeys = new Set(listActiveSessionKeys());
    // Prune bookkeeping for sessions that are no longer active. Deleting from a
    // Map during key iteration is safe (a deleted key is simply not revisited).
    for (const [key, entry] of state.nudges) {
      if (
        !activeKeys.has(key) &&
        (!entry.anchorMessageId ||
          entry.anchorRetainUntilMs === undefined ||
          nowMs >= entry.anchorRetainUntilMs)
      ) {
        state.nudges.delete(key);
      }
    }
    for (const sessionKey of activeKeys) {
      try {
        await maybeNudgeSession(sessionKey, nowMs);
      } catch (err) {
        log.error("progress-nudge: tick failed", {
          sessionKey,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  };

  const scheduleNext = () => {
    if (state.stopped) {
      return;
    }
    if (state.timer) {
      clearTimeout(state.timer);
      state.timer = null;
    }
    if (!state.resolved.enabled || state.resolved.target === "none") {
      return;
    }
    const rawDelay = resolveTickMs(state.resolved);
    if (rawDelay > MAX_SAFE_TIMEOUT_DELAY_MS && !overflowWarned) {
      overflowWarned = true;
      log.warn("progress-nudge: tick delay exceeds Node setTimeout cap; clamping", {
        rawDelayMs: rawDelay,
        clampedMs: MAX_SAFE_TIMEOUT_DELAY_MS,
      });
    }
    const delay = resolveSafeTimeoutDelayMs(rawDelay, { minMs: 1000 });
    state.timer = setTimeout(() => {
      state.timer = null;
      void tick().finally(() => scheduleNext());
    }, delay);
    state.timer.unref?.();
  };

  const handleTerminal = (evt: ReplyRunTerminalEvent): void => {
    const entry = getOrCreateNudgeState(
      evt.sessionKey,
      Number.isFinite(evt.startedAt) ? evt.startedAt : undefined,
    );
    // A `completed` run delivered its real answer, so the exchange is over — the
    // next long turn on this sessionKey is new work and owes a fresh, visible
    // nudge, not a silent edit of a message the user already saw resolved.
    // Anything else (failed/aborted/no-result) is the impatient-follow-up
    // pattern the anchor exists to collapse: keep it, or a stuck run plus a
    // retry goes back to spamming a new "Still working…" per attempt.
    if (evt.result?.kind === "completed") {
      entry.anchorMessageId = undefined;
      entry.anchorRetainUntilMs = undefined;
    } else {
      entry.anchorRetainUntilMs = now() + PROGRESS_NUDGE_ANCHOR_RETENTION_MS;
    }
    // "Went long" is decided from elapsed run time, not from whether a nudge
    // happened to fire — a run that crosses the threshold then fails BETWEEN poll
    // ticks (so nudgeCount is still 0) has still been silent long enough to owe a
    // failure message. Fall back to the nudge count only if startedAt is missing.
    const elapsed = Number.isFinite(evt.startedAt) ? now() - evt.startedAt : 0;
    const wentLong = elapsed >= state.resolved.thresholdMs || entry.nudgeCount > 0;
    const isFailure = evt.result?.kind === "failed" && evt.result.code !== "aborted_by_user";
    const alreadySent = entry.errorNudgeSent;
    // Gate on delivery being enabled AND target !== "none" — a disabled target
    // must suppress the terminal failure message too, not just the in-turn nudges.
    const deliveryOn = state.resolved.enabled && state.resolved.target !== "none";
    if (isFailure && wentLong && !alreadySent && deliveryOn) {
      // Stamp the fire-once guard and KEEP the entry: `wentLong` is elapsed-based,
      // so a repeat terminal for the same session would otherwise re-fire (the
      // guard must outlive this handler). The tick-prune reclaims the entry once
      // the session is no longer active.
      entry.errorNudgeSent = true;
      // Pass the run's route explicitly: the operation is already out of the
      // registry, so a live thread lookup would come back empty.
      void deliverNudge(evt.sessionKey, renderErrorText(), evt.routeThreadId, entry).catch(
        (err: unknown) => {
          log.error("progress-nudge: error-nudge delivery failed", {
            sessionKey: evt.sessionKey,
            error: err instanceof Error ? err.message : String(err),
          });
        },
      );
    }
  };

  const handleAgentEvent = (evt: AgentEventPayload): void => {
    if (!evt.sessionKey || (evt.stream !== "item" && evt.stream !== "tool")) {
      return;
    }
    // Tool/item events never carry their own sessionId (only lifecycle events
    // do), so correlate via the run context instead: a delayed event from a
    // run that is no longer the active reply-run for this sessionKey (e.g. a
    // force-cleared/aborted prior turn whose async tool call reports late)
    // must not overwrite the anchor's progress text with stale content from
    // an unrelated request. Fail open when either side is unresolvable
    // (e.g. in tests) rather than silently dropping all progress text.
    const activeSessionId = resolveActiveSessionId(evt.sessionKey);
    const runSessionId = resolveRunSessionId(evt.runId);
    if (activeSessionId && runSessionId && activeSessionId !== runSessionId) {
      return;
    }
    const progressText = evt.data?.progressText;
    const title = evt.data?.title;
    const text =
      typeof progressText === "string"
        ? progressText
        : typeof title === "string"
          ? title
          : undefined;
    if (!text?.trim()) {
      return;
    }
    getOrCreateNudgeState(evt.sessionKey).progressText = text;
  };

  const updateConfig = (cfg: OpenClawConfig) => {
    if (state.stopped) {
      return;
    }
    state.cfg = cfg;
    const wasEnabled = state.resolved.enabled;
    state.resolved = resolveProgressNudgeConfig(cfg);
    if (state.resolved.enabled !== wasEnabled) {
      log.info(state.resolved.enabled ? "progress-nudge: enabled" : "progress-nudge: disabled", {
        thresholdMs: state.resolved.thresholdMs,
        intervalMs: state.resolved.intervalMs,
        maxNudges: state.resolved.maxNudges,
      });
    }
    scheduleNext();
  };

  const unsubscribeAgentEvents = subscribeAgentEvents(handleAgentEvent);
  const unsubscribeTerminal = subscribeTerminal(handleTerminal);

  const cleanup = () => {
    if (state.stopped) {
      return;
    }
    state.stopped = true;
    unsubscribeAgentEvents();
    unsubscribeTerminal();
    if (state.timer) {
      clearTimeout(state.timer);
    }
    state.timer = null;
    state.nudges.clear();
  };

  opts.abortSignal?.addEventListener("abort", cleanup, { once: true });

  scheduleNext();

  return { stop: cleanup, updateConfig };
}
