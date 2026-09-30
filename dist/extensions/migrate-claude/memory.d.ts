import { l as MigrationItem } from "../../plugin-entry-4jbCdZgF.js";
import { t as ClaudeSource } from "../../source-Czne5iNW.js";
import { t as PlannedTargets } from "../../targets-0MIDIuRB.js";

//#region extensions/migrate-claude/memory.d.ts
declare function buildMemoryItems(params: {
  source: ClaudeSource;
  targets: PlannedTargets;
  overwrite?: boolean;
}): Promise<MigrationItem[]>;
//#endregion
export { buildMemoryItems };