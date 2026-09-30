/**
 * Static identity for names that select core agent factory families before assembly.
 */
export type CoreToolFactoryFamily = "base-coding" | "shell" | "openclaw";
export declare const CORE_TOOL_FACTORY_DESCRIPTORS: readonly [{
    readonly name: "edit";
    readonly family: "base-coding";
}, {
    readonly name: "read";
    readonly family: "base-coding";
}, {
    readonly name: "write";
    readonly family: "base-coding";
}, {
    readonly name: "apply_patch";
    readonly family: "shell";
}, {
    readonly name: "exec";
    readonly family: "shell";
}, {
    readonly name: "process";
    readonly family: "shell";
}, {
    readonly name: "agents_list";
    readonly family: "openclaw";
}, {
    readonly name: "canvas";
    readonly family: "openclaw";
}, {
    readonly name: "cron";
    readonly family: "openclaw";
}, {
    readonly name: "gateway";
    readonly family: "openclaw";
}, {
    readonly name: "get_goal";
    readonly family: "openclaw";
}, {
    readonly name: "heartbeat_respond";
    readonly family: "openclaw";
}, {
    readonly name: "heartbeat_response";
    readonly family: "openclaw";
}, {
    readonly name: "image";
    readonly family: "openclaw";
}, {
    readonly name: "image_generate";
    readonly family: "openclaw";
}, {
    readonly name: "message";
    readonly family: "openclaw";
}, {
    readonly name: "music_generate";
    readonly family: "openclaw";
}, {
    readonly name: "nodes";
    readonly family: "openclaw";
}, {
    readonly name: "pdf";
    readonly family: "openclaw";
}, {
    readonly name: "session_status";
    readonly family: "openclaw";
}, {
    readonly name: "sessions_history";
    readonly family: "openclaw";
}, {
    readonly name: "sessions_list";
    readonly family: "openclaw";
}, {
    readonly name: "sessions_send";
    readonly family: "openclaw";
}, {
    readonly name: "sessions_spawn";
    readonly family: "openclaw";
}, {
    readonly name: "sessions_yield";
    readonly family: "openclaw";
}, {
    readonly name: "skill_workshop";
    readonly family: "openclaw";
}, {
    readonly name: "create_goal";
    readonly family: "openclaw";
}, {
    readonly name: "subagents";
    readonly family: "openclaw";
}, {
    readonly name: "transcripts";
    readonly family: "openclaw";
}, {
    readonly name: "tts";
    readonly family: "openclaw";
}, {
    readonly name: "update_goal";
    readonly family: "openclaw";
}, {
    readonly name: "update_plan";
    readonly family: "openclaw";
}, {
    readonly name: "video_generate";
    readonly family: "openclaw";
}, {
    readonly name: "web_fetch";
    readonly family: "openclaw";
}, {
    readonly name: "web_search";
    readonly family: "openclaw";
}];
export type OpenClawCodingToolConstructionPlan = {
    includeBaseCodingTools: boolean;
    includeShellTools: boolean;
    includeChannelTools: boolean;
    includeOpenClawTools: boolean;
    includePluginTools: boolean;
};
export declare function resolveCoreToolFactoryFamily(name: string): CoreToolFactoryFamily | undefined;
