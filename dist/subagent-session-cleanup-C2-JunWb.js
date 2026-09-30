//#region src/agents/subagent-session-cleanup.ts
/** Deletes a child subagent session and optionally emits session-mode lifecycle hooks. */
async function deleteSubagentSessionForCleanup(params) {
	try {
		await params.callGateway({
			method: "sessions.delete",
			params: {
				key: params.childSessionKey,
				deleteTranscript: true,
				emitLifecycleHooks: params.spawnMode === "session"
			},
			timeoutMs: 1e4
		});
	} catch (error) {
		params.onError?.(error);
	}
}
//#endregion
export { deleteSubagentSessionForCleanup as t };
