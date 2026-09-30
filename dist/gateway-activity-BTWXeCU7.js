//#region src/gateway/gateway-activity.ts
let activeRunCountProbe = null;
/** Install (or clear) the probe. Called by the gateway runtime state on create/release. */
function setGatewayActiveRunCountProbe(probe) {
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
function clearGatewayActiveRunCountProbe(probe) {
	if (activeRunCountProbe === probe) activeRunCountProbe = null;
}
/**
* Live, unaborted run count, or null when it cannot be read: no gateway is running in this
* process, or the probe failed. Callers must treat null as "unknown", never as zero — a
* drain guard that reads null must not conclude the gateway is idle.
*/
function getGatewayActiveRunCount() {
	if (!activeRunCountProbe) return null;
	try {
		const value = activeRunCountProbe();
		return Number.isFinite(value) && value >= 0 ? Math.trunc(value) : null;
	} catch {
		return null;
	}
}
/** Count entries whose abort signal has not fired — the runs a restart would kill. */
function countUnabortedRuns(runs) {
	let count = 0;
	for (const run of runs.values()) if (!run.controller.signal.aborted) count += 1;
	return count;
}
//#endregion
export { setGatewayActiveRunCountProbe as i, countUnabortedRuns as n, getGatewayActiveRunCount as r, clearGatewayActiveRunCountProbe as t };
