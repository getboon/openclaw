import { b as StreamFn, s as CompleteSimpleFn } from "./types-BqnYI5iG.js";
import { Hn as AgentOptions, Vn as Agent$1 } from "./index-LEBm1yuo.js";
//#region src/plugin-sdk/agent-core.d.ts
/** Runtime adapter that lets the package agent-core use OpenClaw LLM helpers. */
declare const openClawAgentCoreRuntime: {
  completeSimple: CompleteSimpleFn;
  streamSimple: StreamFn;
};
/** Agent-core class preconfigured with OpenClaw runtime dependencies. */
declare class Agent extends Agent$1 {
  constructor(options?: AgentOptions);
}
//#endregion
export { openClawAgentCoreRuntime as n, Agent as t };