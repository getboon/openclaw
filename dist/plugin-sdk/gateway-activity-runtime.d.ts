//#region src/gateway/gateway-activity.d.ts
/**
 * Live, unaborted run count, or null when it cannot be read: no gateway is running in this
 * process, or the probe failed. Callers must treat null as "unknown", never as zero — a
 * drain guard that reads null must not conclude the gateway is idle.
 */
declare function getGatewayActiveRunCount(): number | null;
//#endregion
export { getGatewayActiveRunCount };