import { p as logToolLoopAction } from "./diagnostic-DoyQbp1S.js";
import { n as getDiagnosticSessionState } from "./diagnostic-session-state-Gz0nXz2K.js";
import { a as recordToolCallOutcome, i as recordToolCall, r as detectToolCallLoop } from "./tool-loop-detection-B8NA77Cf.js";
//#region src/agents/agent-tools.before-tool-call.runtime.ts
/**
* Lazy runtime dependencies for before_tool_call handling.
* Keeps diagnostics and loop-detection imports behind a seam that tests can
* replace without loading the full runtime graph.
*/
/** Runtime seam for before_tool_call diagnostics and loop detection. */
const beforeToolCallRuntime = {
	getDiagnosticSessionState,
	logToolLoopAction,
	detectToolCallLoop,
	recordToolCall,
	recordToolCallOutcome
};
//#endregion
export { beforeToolCallRuntime };
