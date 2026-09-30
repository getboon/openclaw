import { r as createLegacyPrivateNetworkDoctorContract } from "./ssrf-policy-DqwSPpuy.js";
import "./ssrf-runtime-BEA0pv1w.js";
//#region extensions/tlon/src/doctor-contract.ts
const contract = createLegacyPrivateNetworkDoctorContract({ channelKey: "tlon" });
const legacyConfigRules = contract.legacyConfigRules;
const normalizeCompatibilityConfig = contract.normalizeCompatibilityConfig;
//#endregion
export { normalizeCompatibilityConfig as n, legacyConfigRules as t };
