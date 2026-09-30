export declare const PLUGIN_REGISTRY_STATE: unique symbol;
type PluginRegistry = import("./registry-types.js").PluginRegistry;
type PluginRegistryHostServices = import("./registry-types.js").PluginRegistryParams["hostServices"];
export type RuntimeTrackedPluginRegistry = PluginRegistry;
export type RegistrySurfaceState = {
    registry: RuntimeTrackedPluginRegistry | null;
    pinned: boolean;
    version: number;
};
export type RegistryState = {
    activeRegistry: RuntimeTrackedPluginRegistry | null;
    activeVersion: number;
    httpRoute: RegistrySurfaceState;
    channel: RegistrySurfaceState;
    sessionExtension: RegistrySurfaceState;
    agentEventBridgeUnsubscribe?: (() => void) | undefined;
    key: string | null;
    workspaceDir: string | null;
    runtimeSubagentMode: "default" | "explicit" | "gateway-bindable";
    importedPluginIds: Set<string>;
    /**
     * The real gateway's live host services (cron, etc.), set only by a genuine
     * activation (see setActivePluginRegistry). Ephemeral tool-resolution
     * registries never carry their own hostServices (see PluginRuntimeLoadContext),
     * so durable side-effect APIs fall back to this instead of failing outright.
     */
    hostServices?: PluginRegistryHostServices;
};
export declare function getPluginRegistryState(): RegistryState | undefined;
export declare function getActivePluginChannelRegistryFromState(): RuntimeTrackedPluginRegistry | null;
export declare function getActivePluginRegistryWorkspaceDirFromState(): string | undefined;
export {};
