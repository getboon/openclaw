import type { SkillSnapshot } from "../../skills/types.js";
/** Returns whether a resolved skill file is readable before linking it into the Claude plugin. */
export declare function isClaudeCliSkillFileAccessible(skillFilePath: string): boolean;
export declare function selectClaudePluginSkills(snapshot?: SkillSnapshot, explicitSkillName?: string): NonNullable<SkillSnapshot["resolvedSkills"]>;
/** Prepares Claude CLI `--plugin-dir` args for the current session skill snapshot. */
export declare function prepareClaudeCliSkillsPlugin(params: {
    backendId: string;
    skillsSnapshot?: SkillSnapshot;
    explicitSkillName?: string;
}): Promise<{
    args: string[];
    cleanup: () => Promise<void>;
    pluginDir?: string;
}>;
