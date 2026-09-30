import { n as FailoverReason } from "./types-CqkqBF9N.js";

//#region src/agents/model-fallback.types.d.ts
type FallbackAttempt = {
  provider: string;
  model: string;
  error: string;
  reason?: FailoverReason;
  authMode?: string;
  status?: number;
  code?: string;
};
//#endregion
export { FallbackAttempt as t };