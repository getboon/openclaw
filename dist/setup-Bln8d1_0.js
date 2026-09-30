import "./utils-B8fk9j7G.js";
import "./types.secrets-Dz8NpNuA.js";
import "./setup-helpers-CPWoWqOy.js";
import "./detect-binary-DChAi0WR.js";
import "./setup-wizard-helpers-JvxaQ2Ff.js";
import "./setup-wizard-proxy-BprzXdaJ.js";
//#region src/plugin-sdk/resolution-notes.ts
/** Format a short note that separates successfully resolved targets from unresolved passthrough values. */
function formatResolvedUnresolvedNote(params) {
	if (params.resolved.length === 0 && params.unresolved.length === 0) return;
	return [params.resolved.length > 0 ? `Resolved: ${params.resolved.join(", ")}` : void 0, params.unresolved.length > 0 ? `Unresolved (kept as typed): ${params.unresolved.join(", ")}` : void 0].filter(Boolean).join("\n");
}
//#endregion
export { formatResolvedUnresolvedNote as t };
