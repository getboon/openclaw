import type { PromptMode } from "../../system-prompt.types.js";
export declare function resolveRunPromptPolicy(params: {
    promptMode: PromptMode;
    skillsPrompt: string;
    toolsAllow?: string[];
    explicitSkillName?: string;
}): {
    promptMode: PromptMode;
    skillsPrompt: string | undefined;
};
