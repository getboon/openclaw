import { o as MsgContext } from "./templating-a8lZ_mwE.js";
import { n as GroupKeyResolution } from "./types-CKYhADQJ.js";
import { t as InboundLastRouteUpdate } from "./session.types-CYu3MKF3.js";

//#region src/channels/session.d.ts
declare function recordInboundSession(params: {
  storePath: string;
  sessionKey: string;
  ctx: MsgContext;
  groupResolution?: GroupKeyResolution | null;
  createIfMissing?: boolean;
  updateLastRoute?: InboundLastRouteUpdate;
  onRecordError: (err: unknown) => void;
  trackSessionMetaTask?: (task: Promise<unknown>) => void;
}): Promise<void>;
//#endregion
export { recordInboundSession as t };