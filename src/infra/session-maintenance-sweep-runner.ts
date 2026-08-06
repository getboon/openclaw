// Periodically sweeps every configured agent's session store through the
// *dry-run preview* path of the same cleanup the `openclaw sessions cleanup`
// CLI already uses, and logs a summary every tick, including when nothing
// changed. session.maintenance today only runs as a side effect of session
// writes (commitReplySessionInitialization), so idle/low-traffic stores can
// go long stretches unevaluated, and every existing prune/cap/disk-budget log
// line only fires on nonzero effect — "ran, 0 eligible" and "never ran" were
// otherwise indistinguishable. dryRun: true keeps this genuinely read-only
// whatever the operator's session.maintenance.mode is: previewStoreCleanup
// works on a cloned store, simulates the disk budget and artifact prune, and
// never takes the session write lock or deletes a file — so an `enforce`
// deployment gets the same observability as a `warn` one, and the sweep never
// evicts or prunes on its own. This intentionally does not change what gets
// protected or evicted.
//
// Cost tradeoff, disclosed rather than hidden: each tick still does a real
// (read-only) load + clone of every configured store, once per hour and once
// on startup. On a store already large enough to be under heap pressure, that
// transiently adds load — this sweep trades a bounded, hourly, read-only cost
// for the visibility that was otherwise unobtainable from logs alone.
import {
  runSessionsCleanup,
  type SessionCleanupSummary,
} from "../config/sessions/cleanup-service.js";
import { resolveSessionStoreTargets, type SessionStoreTarget } from "../config/sessions/targets.js";
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
  resolveTargets?: typeof resolveSessionStoreTargets;
  /**
   * Defaults to the constructor's `cfg`, refreshed via `updateConfig()`.
   * `session.*` config paths (session.store, session.maintenance.*) are
   * classified `kind: "none"` in the gateway's reload plan
   * (config-reload-plan.ts) because nearly every other session-config reader
   * re-resolves live config per call, so no reload action was ever needed for
   * them. This runner is the first long-lived consumer that instead caches a
   * snapshot across ticks — `updateConfig()` only fires when the reload plan
   * sets `restartHeartbeat`, which a session-only config change never does.
   * The gateway wiring overrides this default with a live `getRuntimeConfig()`
   * read so a live session.maintenance/session.store change is picked up on
   * the sweep's own next tick instead of silently waiting for a full restart.
   */
  getConfig?: () => OpenClawConfig;
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
    // Always true here. Logged so the counts below cannot be misread as work this
    // sweep performed: they are what the store's configured policy would do.
    dryRun: summary.dryRun,
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
    // pruneUnreferencedSessionArtifacts logs nothing of its own, so this is the
    // only place orphaned-artifact pressure becomes visible to operators.
    unreferencedArtifacts: {
      removedFiles: summary.unreferencedArtifacts.removedFiles,
      freedBytes: summary.unreferencedArtifacts.freedBytes,
    },
    wouldMutate: summary.wouldMutate,
  });
}

export function startSessionMaintenanceSweepRunner(opts: {
  cfg: OpenClawConfig;
  deps?: SessionMaintenanceSweepDeps;
}): SessionMaintenanceSweepRunner {
  const runCleanup = opts.deps?.runCleanup ?? runSessionsCleanup;
  const resolveTargets = opts.deps?.resolveTargets ?? resolveSessionStoreTargets;
  const logger = opts.deps?.log ?? log;
  const intervalMs = opts.deps?.intervalMs ?? SESSION_MAINTENANCE_SWEEP_INTERVAL_MS;

  const state = { cfg: opts.cfg, stopped: false };
  const getConfig = opts.deps?.getConfig ?? (() => state.cfg);
  let inFlight: Promise<void> | null = null;

  const sweepTarget = async (cfg: OpenClawConfig, target: SessionStoreTarget): Promise<void> => {
    try {
      const result = await runCleanup({
        cfg,
        opts: { dryRun: true },
        targets: [target],
      });
      // Dry-run leaves appliedSummaries empty; previewResults[].summary is the
      // read-only per-store view (same SessionCleanupSummary shape).
      for (const { summary } of result.previewResults) {
        logSweepSummary(logger, summary);
      }
    } catch (err) {
      // Scoped to this one target: a corrupt/unreadable store must not hide
      // the fleet-wide observability this runner exists to provide for every
      // OTHER configured store.
      logger.error("session maintenance sweep failed for store", {
        agentId: target.agentId,
        storePath: target.storePath,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const tick = (): Promise<void> => {
    if (inFlight) {
      return inFlight;
    }
    inFlight = (async () => {
      let cfg: OpenClawConfig;
      let targets: SessionStoreTarget[];
      try {
        // getConfig() shares this try/catch with resolveTargets(): the gateway
        // wires it to getRuntimeConfig(), which can throw on validation
        // failure, and an uncaught throw here would reject the tick's promise
        // unhandled (fired via `void tick()`) and silently kill the loop —
        // the opposite of this runner's whole purpose.
        cfg = getConfig();
        targets = resolveTargets(cfg, { allAgents: true });
      } catch (err) {
        logger.error("session maintenance sweep failed to resolve stores", {
          error: err instanceof Error ? err.message : String(err),
        });
        return;
      }
      for (const target of targets) {
        await sweepTarget(cfg, target);
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
