import { i as OpenClawConfig } from "../../types.openclaw-C5-5RYY-.js";
import { jt as ProviderAuthResult } from "../../types-D56T6DDo.js";
import { n as readClaudeCliCredentialsForSetup } from "../../cli-auth-seam-Zy--46GO.js";
//#region extensions/anthropic/cli-migration.d.ts
type ClaudeCliCredential = NonNullable<ReturnType<typeof readClaudeCliCredentialsForSetup>>;
/** Build the config migration result for adopting Claude CLI-backed Anthropic defaults. */
declare function buildAnthropicCliMigrationResult(config: OpenClawConfig, credential?: ClaudeCliCredential | null): ProviderAuthResult;
//#endregion
export { buildAnthropicCliMigrationResult };