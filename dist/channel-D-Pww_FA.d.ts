import { t as BaseProbeResult } from "./types.core-9OlsJj7i.js";
import { t as ChannelPlugin } from "./types.plugin-CpPPGIEZ.js";
import { t as ResolvedMatrixAccount } from "./accounts-Wx-Z0OKF.js";
//#region extensions/matrix/src/matrix/probe.d.ts
type MatrixProbe = BaseProbeResult & {
  status?: number | null;
  elapsedMs: number;
  userId?: string | null;
};
//#endregion
//#region extensions/matrix/src/channel.d.ts
declare const matrixPlugin: ChannelPlugin<ResolvedMatrixAccount, MatrixProbe>;
//#endregion
export { matrixPlugin as t };