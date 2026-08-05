// Periodically sweeps every configured agent's session store through the
// same enforce/warn-aware cleanup the `openclaw sessions cleanup` CLI
// already uses, and logs a summary every tick, including when nothing
// changed. session.maintenance today only runs as a side effect of session
// writes (commitReplySessionInitialization), so idle/low-traffic stores can
// go long stretches unevaluated, and every existing prune/cap/disk-budget log
// line only fires on nonzero effect — "ran, 0 eligible" and "never ran" were
// otherwise indistinguishable. This intentionally does not change what gets
// protected or evicted; see
// docs/superpowers/specs/2026-08-05-session-maintenance-sweep-observability-design.md.
import {
  runSessionsCleanup,
  type SessionCleanupSummary,
} from "../config/sessions/cleanup-service.js";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import { createSubsystemLogger } from "../logging/subsystem.js";

const log = createSubsystemLogger("gateway/session-maintenance-sweep");

/** No new config knob: this is an implementation cadence, not operator policy. */
export const SESSION_MAINTENANCE_SWEEP_INTERVAL_MS = 60 * 60_000;

export type SessionMaintenanceSweepRunner = {
  stop: () => void;
  updateConfig: (cfg: OpenClawConfig) => void;
};

type SessionMaintenanceSweepLogger = {
  info: (message: string, context?: Record<string, unknown>) => void;
  error: (message: string, context?: Record<string, unknown>) => void;
};

/** Injectable seams so tests can drive ticks without real session stores or timers. */
export type SessionMaintenanceSweepDeps = {
  runCleanup?: typeof runSessionsCleanup;
  log?: SessionMaintenanceSweepLogger;
  intervalMs?: number;
};

function logSweepSummary(
  logger: SessionMaintenanceSweepLogger,
  summary: SessionCleanupSummary,
): void {
  logger.info("session maintenance sweep", {
    agentId: summary.agentId,
    storePath: summary.storePath,
    mode: summary.mode,
    beforeCount: summary.beforeCount,
    afterCount: summary.afterCount,
    pruned: summary.pruned,
    capped: summary.capped,
    diskBudget: summary.diskBudget
      ? {
          totalBytesBefore: summary.diskBudget.totalBytesBefore,
          totalBytesAfter: summary.diskBudget.totalBytesAfter,
          maxBytes: summary.diskBudget.maxBytes,
          overBudget: summary.diskBudget.overBudget,
        }
      : null,
    wouldMutate: summary.wouldMutate,
  });
}

export function startSessionMaintenanceSweepRunner(opts: {
  cfg: OpenClawConfig;
  deps?: SessionMaintenanceSweepDeps;
}): SessionMaintenanceSweepRunner {
  const runCleanup = opts.deps?.runCleanup ?? runSessionsCleanup;
  const logger = opts.deps?.log ?? log;
  const intervalMs = opts.deps?.intervalMs ?? SESSION_MAINTENANCE_SWEEP_INTERVAL_MS;

  const state = { cfg: opts.cfg, stopped: false };
  let inFlight: Promise<void> | null = null;

  const tick = (): Promise<void> => {
    if (inFlight) {
      return inFlight;
    }
    inFlight = (async () => {
      try {
        const result = await runCleanup({
          cfg: state.cfg,
          opts: { allAgents: true, dryRun: false },
        });
        for (const summary of result.appliedSummaries) {
          logSweepSummary(logger, summary);
        }
      } catch (err) {
        logger.error("session maintenance sweep failed", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    })().finally(() => {
      inFlight = null;
    });
    return inFlight;
  };

  const interval = setInterval(() => {
    if (!state.stopped) {
      void tick();
    }
  }, intervalMs);
  interval.unref?.();

  void tick();

  return {
    stop: () => {
      state.stopped = true;
      clearInterval(interval);
    },
    updateConfig: (cfg: OpenClawConfig) => {
      state.cfg = cfg;
    },
  };
}
