import type { GatewayServiceEnvironmentValueSource } from "./service-types.js";
export type MutableServiceEnvPlan = {
    environment: Record<string, string | undefined>;
    environmentValueSources: Record<string, GatewayServiceEnvironmentValueSource | undefined>;
};
export declare function createMutableServiceEnvPlan(): MutableServiceEnvPlan;
export declare function normalizeServiceEnvPlanKey(rawKey: string): string | undefined;
export declare function addServiceEnvPlanEntries(plan: MutableServiceEnvPlan, entries: Record<string, string | undefined>, options: {
    includeRawKeys?: boolean;
    valueSource?: GatewayServiceEnvironmentValueSource | ((params: {
        rawKey: string;
        normalizedKey: string;
    }) => GatewayServiceEnvironmentValueSource | undefined);
}): void;
export declare function compactServiceEnvPlanValueSources(plan: MutableServiceEnvPlan): void;
