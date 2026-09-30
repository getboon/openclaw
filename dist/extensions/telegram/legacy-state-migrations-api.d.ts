import { i as OpenClawConfig } from "../../types.openclaw-C5-5RYY-.js";
import { U as ChannelLegacyStateMigrationPlan } from "../../types.core-9OlsJj7i.js";
//#region extensions/telegram/src/state-migrations.d.ts
declare function detectTelegramLegacyStateMigrations(params: {
  cfg: OpenClawConfig;
  env: NodeJS.ProcessEnv;
  stateDir?: string;
}): Promise<ChannelLegacyStateMigrationPlan[]>;
//#endregion
export { detectTelegramLegacyStateMigrations };