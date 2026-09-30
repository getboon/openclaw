import { i as OpenClawConfig } from "../../types.openclaw-C5-5RYY-.js";
import { n as applyOpencodeGoConfig, r as applyOpencodeGoProviderConfig, t as OPENCODE_GO_DEFAULT_MODEL_REF } from "../../onboard-CJKg8e-0.js";

//#region extensions/opencode-go/api.d.ts
declare function applyOpencodeGoModelDefault(cfg: OpenClawConfig): {
  next: OpenClawConfig;
  changed: boolean;
};
//#endregion
export { OPENCODE_GO_DEFAULT_MODEL_REF, applyOpencodeGoConfig, applyOpencodeGoModelDefault, applyOpencodeGoProviderConfig };