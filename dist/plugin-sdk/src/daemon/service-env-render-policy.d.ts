/** Applies platform render policy for managed daemon service environment values. */
import { type MutableServiceEnvPlan } from "./service-env-plan.js";
export declare function applyManagedServiceEnvRenderPolicy(params: {
    plan: MutableServiceEnvPlan;
    managedServiceEnvKeys: string | undefined;
    serviceEnvironment: Record<string, string | undefined>;
    platform: NodeJS.Platform;
    existingEnvironmentFileEnvironment: Record<string, string | undefined>;
    stateDirDotEnvEnvironment: Record<string, string | undefined>;
    configSecretRefEnvironment: Record<string, string | undefined>;
}): void;
