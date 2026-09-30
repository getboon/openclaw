import { o as MsgContext } from "./templating-Ce4r6y4Y.js";
import { n as GroupKeyResolution } from "./types-BrRkOXcO.js";
import { t as InboundLastRouteUpdate } from "./session.types-CHDYIQOS.js";

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