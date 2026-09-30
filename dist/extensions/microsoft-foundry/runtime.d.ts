import { Lt as ProviderPrepareRuntimeAuthContext, Rt as ProviderPreparedRuntimeAuth } from "../../plugin-entry-4jbCdZgF.js";
//#region extensions/microsoft-foundry/runtime.d.ts
declare function resetFoundryRuntimeAuthCaches(): void;
declare function prepareFoundryRuntimeAuth(ctx: ProviderPrepareRuntimeAuthContext): Promise<ProviderPreparedRuntimeAuth>;
//#endregion
export { prepareFoundryRuntimeAuth, resetFoundryRuntimeAuthCaches };