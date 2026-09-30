import { i as OpenClawConfig } from "./types.openclaw-C5-5RYY-.js";
import { Hl as GenerateVideoRuntimeResult, Vl as GenerateVideoParams } from "./types-D56T6DDo.js";
import { t as SubsystemLogger } from "./subsystem-CfQVin8T.js";
import { n as getProviderEnvVars } from "./provider-env-vars-B-pnEXSF.js";
import { s as VideoGenerationProvider } from "./types-Bs7bp8Pv.js";
import { n as listVideoGenerationProviders, t as getVideoGenerationProvider } from "./provider-registry-BWh0F0tp.js";

//#region src/video-generation/runtime.d.ts
declare const log: SubsystemLogger;
type VideoGenerationRuntimeDeps = {
  getProvider?: typeof getVideoGenerationProvider;
  listProviders?: typeof listVideoGenerationProviders;
  getProviderEnvVars?: typeof getProviderEnvVars;
  log?: Pick<typeof log, "debug" | "warn">;
};
declare function listRuntimeVideoGenerationProviders(params?: {
  config?: OpenClawConfig;
}, deps?: VideoGenerationRuntimeDeps): VideoGenerationProvider[];
declare function generateVideo(params: GenerateVideoParams, deps?: VideoGenerationRuntimeDeps): Promise<GenerateVideoRuntimeResult>;
//#endregion
export { listRuntimeVideoGenerationProviders as n, generateVideo as t };