import { t as FinalizedMsgContext } from "./templating-Ce4r6y4Y.js";
import { i as OpenClawConfig } from "./types.openclaw-B8P7XeUR.js";
import { Hr as finalizeInboundContext, Rr as formatAgentEnvelope, Vr as resolveEnvelopeFormatOptions, Wr as DispatchReplyWithBufferedBlockDispatcher } from "./types-EobE1w4i.js";
import { o as resolveStorePath } from "./sessions-CTh_JQvW.js";
import { t as OutboundReplyPayload } from "./reply-payload-BLeaC3Wn.js";
import { t as recordInboundSession } from "./session-DHtM9yzK.js";
//#region src/channels/direct-dm.d.ts
type DirectDmRoutePeer = {
  kind: "direct";
  id: string;
};
type DirectDmRoute = {
  agentId: string;
  sessionKey: string;
  accountId?: string;
};
type DirectDmRuntime = {
  channel: {
    routing: {
      resolveAgentRoute: (params: {
        cfg: OpenClawConfig;
        channel: string;
        accountId: string;
        peer: DirectDmRoutePeer;
      }) => DirectDmRoute;
    };
    session: {
      resolveStorePath: typeof resolveStorePath;
      readSessionUpdatedAt: (params: {
        storePath: string;
        sessionKey: string;
      }) => number | undefined;
      recordInboundSession: typeof recordInboundSession;
    };
    reply: {
      resolveEnvelopeFormatOptions: (cfg: OpenClawConfig) => ReturnType<typeof resolveEnvelopeFormatOptions>;
      formatAgentEnvelope: typeof formatAgentEnvelope;
      finalizeInboundContext: typeof finalizeInboundContext;
      dispatchReplyWithBufferedBlockDispatcher: DispatchReplyWithBufferedBlockDispatcher;
    };
  };
};
/** Route, envelope, record, and dispatch one direct-DM turn through the standard pipeline. */
declare function dispatchInboundDirectDmWithRuntime(params: {
  cfg: OpenClawConfig;
  runtime: DirectDmRuntime;
  channel: string;
  channelLabel: string;
  accountId: string;
  peer: DirectDmRoutePeer;
  senderId: string;
  senderAddress: string;
  recipientAddress: string;
  conversationLabel: string;
  rawBody: string;
  messageId: string;
  timestamp?: number;
  commandAuthorized?: boolean;
  bodyForAgent?: string;
  commandBody?: string;
  provider?: string;
  surface?: string;
  originatingChannel?: string;
  originatingTo?: string;
  extraContext?: Record<string, unknown>;
  deliver: (payload: OutboundReplyPayload) => Promise<void>;
  onRecordError: (err: unknown) => void;
  onDispatchError: (err: unknown, info: {
    kind: string;
  }) => void;
}): Promise<{
  route: DirectDmRoute;
  storePath: string;
  ctxPayload: FinalizedMsgContext;
}>;
//#endregion
export { dispatchInboundDirectDmWithRuntime as t };