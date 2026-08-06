import type { PromptMode } from "../../system-prompt.types.js";

export function resolveRunPromptPolicy(params: {
  promptMode: PromptMode;
  skillsPrompt: string;
  toolsAllow?: string[];
  explicitSkillName?: string;
}): {
  promptMode: PromptMode;
  skillsPrompt: string | undefined;
} {
  if (!params.toolsAllow?.length) {
    return {
      promptMode: params.promptMode,
      skillsPrompt: params.skillsPrompt,
    };
  }
  return {
    promptMode: "minimal",
    skillsPrompt: params.explicitSkillName ? params.skillsPrompt : undefined,
  };
}
