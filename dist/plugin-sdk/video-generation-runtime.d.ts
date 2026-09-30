import { i as OpenClawConfig } from "./types.openclaw-B8P7XeUR.js";
import { Hl as GenerateVideoRuntimeResult, Vl as GenerateVideoParams } from "./types-EobE1w4i.js";
import { t as SubsystemLogger } from "./subsystem-Boo2DQIV.js";
import { n as getProviderEnvVars } from "./provider-env-vars-B1Q2qBRu.js";
import { s as VideoGenerationProvider } from "./types-Dvi5Yv7z.js";
import { n as listVideoGenerationProviders, t as getVideoGenerationProvider } from "./provider-registry-B4z1ZSB3.js";

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
export { type GenerateVideoParams, type GenerateVideoRuntimeResult, generateVideo, listRuntimeVideoGenerationProviders };