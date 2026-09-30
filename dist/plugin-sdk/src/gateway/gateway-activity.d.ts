import type { ChatAbortControllerEntry } from "./chat-abort.js";
type ActiveRunCountProbe = () => number;
/** Install (or clear) the probe. Called by the gateway runtime state on create/release. */
export declare function setGatewayActiveRunCountProbe(probe: ActiveRunCountProbe | null): void;
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
export declare function clearGatewayActiveRunCountProbe(probe: ActiveRunCountProbe): void;
/**
 * Live, unaborted run count, or null when it cannot be read: no gateway is running in this
 * process, or the probe failed. Callers must treat null as "unknown", never as zero — a
 * drain guard that reads null must not conclude the gateway is idle.
 */
export declare function getGatewayActiveRunCount(): number | null;
/** Count entries whose abort signal has not fired — the runs a restart would kill. */
export declare function countUnabortedRuns(runs: ReadonlyMap<string, ChatAbortControllerEntry>): number;
export {};
