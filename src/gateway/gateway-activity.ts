// Gateway activity probe: lets in-process plugins ask "how many runs are live right now?"
// without reaching into gateway internals. The gateway runtime state owns the only probe;
// it installs one when it creates the abort-controller map and clears it on release, so a
// closed gateway reports "unknown" instead of a stale count from a dead run map.
import type { ChatAbortControllerEntry } from "./chat-abort.js";

type ActiveRunCountProbe = () => number;

let activeRunCountProbe: ActiveRunCountProbe | null = null;

/** Install (or clear) the probe. Called by the gateway runtime state on create/release. */
export function setGatewayActiveRunCountProbe(probe: ActiveRunCountProbe | null): void {
  activeRunCountProbe = probe;
}

/**
 * Clear the probe only if `probe` is the one currently installed.
 *
 * Runtime lifecycles can overlap: a replacement gateway may create its runtime state (and
 * install its probe) before the outgoing one finishes releasing. An unconditional clear on
 * that late release would drop the LIVE runtime's probe, and every later read would report
 * "unknown" while runs were actually in flight. Readers treat unknown as "do not act", so
 * this is not dangerous on its own — but it silently disables the drain guard for the rest
 * of the process's life, which defeats the point of having one.
 */
export function clearGatewayActiveRunCountProbe(probe: ActiveRunCountProbe): void {
  if (activeRunCountProbe === probe) {
    activeRunCountProbe = null;
  }
}

/**
 * Live, unaborted run count, or null when it cannot be read: no gateway is running in this
 * process, or the probe failed. Callers must treat null as "unknown", never as zero — a
 * drain guard that reads null must not conclude the gateway is idle.
 */
export function getGatewayActiveRunCount(): number | null {
  if (!activeRunCountProbe) {
    return null;
  }
  try {
    const value = activeRunCountProbe();
    return Number.isFinite(value) && value >= 0 ? Math.trunc(value) : null;
  } catch {
    return null;
  }
}

/** Count entries whose abort signal has not fired — the runs a restart would kill. */
export function countUnabortedRuns(runs: ReadonlyMap<string, ChatAbortControllerEntry>): number {
  let count = 0;
  for (const run of runs.values()) {
    if (!run.controller.signal.aborted) {
      count += 1;
    }
  }
  return count;
}
