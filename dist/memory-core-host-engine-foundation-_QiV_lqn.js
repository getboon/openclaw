import "./paths-CViT2Nwu.js";
import "./fs-safe-aqmM_n6V.js";
import "./utils-B8fk9j7G.js";
import "./types.secrets-Dz8NpNuA.js";
import "./subsystem-CYwCorYs.js";
import "./agent-scope-XIomFVd1.js";
import "./config-Dft2iRNk.js";
import "./mime-DbeX-K4R.js";
import "./paths-DfUJ_nbS.js";
import { n as onInternalSessionTranscriptUpdate } from "./transcript-events-tew67ry7.js";
import "./memory-search-DJUCXV3O.js";
import "./fs-utils-B96BoZUG.js";
import "./openclaw-runtime-config-DU8TH36H.js";
import "./openclaw-runtime-session-DU8TH36H.js";
//#region src/plugin-sdk/memory-core-host-engine-foundation.ts
/**
* Public SDK foundation surface for memory host engine config, paths, and shared helpers.
*/
const MEMORY_CORE_TRANSCRIPT_UPDATE_SUBSCRIBER_KEY = Symbol.for("openclaw.memoryCore.sessionTranscriptUpdateSubscriber");
globalThis[MEMORY_CORE_TRANSCRIPT_UPDATE_SUBSCRIBER_KEY] ??= onInternalSessionTranscriptUpdate;
//#endregion
export {};
