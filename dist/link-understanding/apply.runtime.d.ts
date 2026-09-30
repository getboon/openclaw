import { i as OpenClawConfig } from "../types.openclaw-C5-5RYY-.js";
import { o as MsgContext } from "../templating-a8lZ_mwE.js";

//#region src/link-understanding/apply.d.ts
type ApplyLinkUnderstandingResult = {
  outputs: string[];
  urls: string[];
};
/** Runs link understanding and folds successful outputs into the inbound context. */
declare function applyLinkUnderstanding(params: {
  ctx: MsgContext;
  cfg: OpenClawConfig;
}): Promise<ApplyLinkUnderstandingResult>;
//#endregion
export { applyLinkUnderstanding };