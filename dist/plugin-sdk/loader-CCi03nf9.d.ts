import { i as OpenClawConfig, p as PluginInstallRecord } from "./types.openclaw-B8P7XeUR.js";
import { n as PluginManifestRegistry, r as PluginDiscoveryResult } from "./manifest-registry-BHpzJG0O.js";
import { Qn as CreatePluginRuntimeOptions, ht as PluginLogger } from "./types-EobE1w4i.js";
import { n as GatewayRequestHandler } from "./types-CJ3qM6NQ.js";
import { r as PluginRegistryParams } from "./registry-types-foGw_Pti.js";
import { t as PluginSdkResolutionPreference } from "./sdk-alias-cV_L6leE.js";

//#region src/plugins/loader.d.ts
type PluginLoadOptions = {
  config?: OpenClawConfig;
  activationSourceConfig?: OpenClawConfig;
  autoEnabledReasons?: Readonly<Record<string, string[]>>;
  workspaceDir?: string;
  installRecords?: Record<string, PluginInstallRecord>;
  env?: NodeJS.ProcessEnv;
  resolveRawConfigEnvVars?: boolean;
  logger?: PluginLogger;
  coreGatewayHandlers?: Record<string, GatewayRequestHandler>;
  coreGatewayMethodNames?: readonly string[];
  hostServices?: PluginRegistryParams["hostServices"];
  runtimeOptions?: CreatePluginRuntimeOptions;
  startupTrace?: {
    detail: (name: string, metrics: ReadonlyArray<readonly [string, number | string]>) => void;
  };
  pluginSdkResolution?: PluginSdkResolutionPreference;
  cache?: boolean;
  mode?: "full" | "validate";
  onlyPluginIds?: string[];
  includeSetupOnlyChannelPlugins?: boolean;
  forceSetupOnlyChannelPlugins?: boolean;
  requireSetupEntryForSetupOnlyChannelPlugins?: boolean;
  /**
   * Prefer `setupEntry` for configured channel plugins that explicitly opt in
   * via package metadata because their setup entry covers the pre-listen startup surface.
   */
  preferSetupRuntimeForChannelPlugins?: boolean;
  /**
   * Load channel runtime entries even when setup entries are available. Plugin CLI
   * registration needs the runtime entry because setup entries only own setup state.
   */
  forceFullRuntimeForChannelPlugins?: boolean;
  /**
   * For hot startup paths, prefer bundled plugin JS artifacts over source TS
   * entrypoints when both are present in a source checkout.
   */
  preferBuiltPluginArtifacts?: boolean;
  toolDiscovery?: boolean;
  activate?: boolean;
  loadModules?: boolean;
  throwOnLoadError?: boolean;
  manifestRegistry?: PluginManifestRegistry;
  discovery?: PluginDiscoveryResult;
};
//#endregion
export { PluginLoadOptions as t };