import { n as zalouserSetupAdapter } from "./setup-core-C6LRb8r_.js";
import { t as createZalouserPluginBase } from "./shared-OTVpLpWm.js";
import { t as zalouserSetupWizard } from "./setup-surface-Lz6NPK3v.js";
//#region extensions/zalouser/src/channel.setup.ts
const zalouserSetupPlugin = { ...createZalouserPluginBase({
	setupWizard: zalouserSetupWizard,
	setup: zalouserSetupAdapter
}) };
//#endregion
export { zalouserSetupPlugin as t };
