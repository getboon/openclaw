// Web search runtime resolves configured search providers and executes searches.
import {
  normalizeLowercaseStringOrEmpty,
  normalizeOptionalLowercaseString,
} from "@openclaw/normalization-core/string-coerce";
import { uniqueStrings } from "@openclaw/normalization-core/string-normalization";
import {
  hasWebProviderEntryCredential,
  providerRequiresCredential,
  readWebProviderEnvValue,
  resolveWebProviderConfig,
} from "../../packages/web-content-core/src/provider-runtime-shared.js";
import { resolveDefaultAgentDir } from "../agents/agent-scope-config.js";
import { hasAuthProfileForProvider } from "../agents/tools/model-config.helpers.js";
import {
  getRuntimeConfigSnapshot,
  getRuntimeConfigSourceSnapshot,
  selectApplicableRuntimeConfig,
} from "../config/runtime-snapshot.js";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import { logVerbose } from "../globals.js";
import { resolveManifestContractOwnerPluginId } from "../plugins/plugin-registry-contributions.js";
import type { PluginWebSearchProviderEntry } from "../plugins/types.js";
import {
  resolvePluginWebSearchProviders,
  resolveRuntimeWebSearchProviders,
} from "../plugins/web-search-providers.runtime.js";
import { sortWebSearchProvidersForAutoDetect } from "../plugins/web-search-providers.shared.js";
import { getActiveRuntimeWebToolsMetadata } from "../secrets/runtime-web-tools-state.js";
import type { RuntimeWebSearchMetadata } from "../secrets/runtime-web-tools.types.js";
import type {
  ResolveWebSearchDefinitionParams,
  RunWebSearchParams,
  RunWebSearchResult,
  RuntimeWebSearchConfig as WebSearchConfig,
} from "./runtime-types.js";

function resolveSearchConfig(cfg?: OpenClawConfig): WebSearchConfig {
  return resolveWebProviderConfig(cfg, "search") as NonNullable<WebSearchConfig> | undefined;
}

function resolveWebSearchRuntimeConfig(params?: {
  config?: OpenClawConfig;
  preferInputConfig?: boolean;
}): OpenClawConfig | undefined {
  if (params?.preferInputConfig && params.config) {
    return params.config;
  }
  return selectApplicableRuntimeConfig({
    inputConfig: params?.config,
    runtimeConfig: getRuntimeConfigSnapshot(),
    runtimeSourceConfig: getRuntimeConfigSourceSnapshot(),
  });
}

/** Resolves whether web_search is enabled for the current config/sandbox. */
function resolveWebSearchEnabled(params: {
  search?: WebSearchConfig;
  sandboxed?: boolean;
}): boolean {
  if (typeof params.search?.enabled === "boolean") {
    return params.search.enabled;
  }
  if (params.sandboxed) {
    return true;
  }
  return true;
}

function hasEntryCredential(
  provider: Pick<
    PluginWebSearchProviderEntry,
    | "credentialPath"
    | "id"
    | "authProviderId"
    | "envVars"
    | "getConfiguredCredentialValue"
    | "getConfiguredCredentialFallback"
    | "getCredentialValue"
    | "requiresCredential"
  >,
  config: OpenClawConfig | undefined,
  search: WebSearchConfig | undefined,
  agentDir?: string,
): boolean {
  return hasWebProviderEntryCredential({
    provider,
    config,
    toolConfig: search as Record<string, unknown> | undefined,
    resolveRawValue: ({ provider: currentProvider, config: currentConfig }) =>
      currentProvider.getConfiguredCredentialValue?.(currentConfig),
    resolveFallbackRawValue: ({ provider: currentProvider, config: currentConfig }) =>
      currentProvider.getConfiguredCredentialFallback?.(currentConfig)?.value,
    resolveEnvValue: ({ provider: currentProvider, configuredEnvVarId }) =>
      (configuredEnvVarId ? readWebProviderEnvValue([configuredEnvVarId]) : undefined) ??
      readWebProviderEnvValue(currentProvider.envVars),
    resolveProviderAuthValue: (providerId) =>
      hasAuthProfileForProvider({
        provider: providerId,
        agentDir: agentDir?.trim() || resolveDefaultAgentDir(config ?? {}),
      }),
  });
}

function hasImplicitProviderSelectionSignal(
  provider: Pick<
    PluginWebSearchProviderEntry,
    | "credentialPath"
    | "id"
    | "authProviderId"
    | "envVars"
    | "getConfiguredCredentialValue"
    | "getConfiguredCredentialFallback"
    | "getCredentialValue"
    | "requiresCredential"
  >,
  config: OpenClawConfig | undefined,
  search: WebSearchConfig | undefined,
  agentDir?: string,
): boolean {
  if (!providerRequiresCredential(provider)) {
    return false;
  }
  return hasEntryCredential(provider, config, search, agentDir);
}

/** Reports whether a web_search provider has usable configured credentials. */
export function isWebSearchProviderConfigured(params: {
  provider: Pick<
    PluginWebSearchProviderEntry,
    | "credentialPath"
    | "id"
    | "authProviderId"
    | "envVars"
    | "getConfiguredCredentialValue"
    | "getConfiguredCredentialFallback"
    | "getCredentialValue"
    | "requiresCredential"
  >;
  config?: OpenClawConfig;
}): boolean {
  const config = resolveWebSearchRuntimeConfig({ config: params.config });
  return hasEntryCredential(params.provider, config, resolveSearchConfig(config));
}

/** Lists runtime web_search providers after applying runtime config snapshots. */
export function listWebSearchProviders(params?: {
  config?: OpenClawConfig;
}): PluginWebSearchProviderEntry[] {
  const config = resolveWebSearchRuntimeConfig({ config: params?.config });
  return resolveRuntimeWebSearchProviders({
    config,
  });
}

/** Lists plugin-configured web_search providers without runtime-only providers. */
export function listConfiguredWebSearchProviders(params?: {
  config?: OpenClawConfig;
}): PluginWebSearchProviderEntry[] {
  const config = resolveWebSearchRuntimeConfig({ config: params?.config });
  return resolvePluginWebSearchProviders({
    config,
  });
}

/** Resolves configured or auto-detected web_search provider id. */
export function resolveWebSearchProviderId(params: {
  search?: WebSearchConfig;
  config?: OpenClawConfig;
  agentDir?: string;
  providers?: PluginWebSearchProviderEntry[];
}): string {
  const config = resolveWebSearchRuntimeConfig({ config: params.config });
  const search = params.search ?? resolveSearchConfig(config);
  const providers = sortWebSearchProvidersForAutoDetect(
    params.providers ??
      resolvePluginWebSearchProviders({
        config,
      }),
  );
  const raw =
    search && "provider" in search ? normalizeLowercaseStringOrEmpty(search.provider) : "";

  if (raw) {
    const explicit = providers.find((provider) => provider.id === raw);
    if (explicit) {
      return explicit.id;
    }
  }

  if (!raw) {
    for (const provider of providers) {
      if (!hasImplicitProviderSelectionSignal(provider, config, search, params.agentDir)) {
        continue;
      }
      logVerbose(
        `web_search: no provider configured, auto-detected "${provider.id}" from available credentials`,
      );
      return provider.id;
    }
    return "";
  }

  return "";
}

function resolveRuntimePreferredWebSearchProviderId(params: {
  config?: OpenClawConfig;
  search?: WebSearchConfig;
  runtimeWebSearch?: RuntimeWebSearchMetadata;
  providers?: PluginWebSearchProviderEntry[];
  agentDir?: string;
}): string | undefined {
  const runtimeProviderId = normalizeOptionalLowercaseString(
    params.runtimeWebSearch?.selectedProvider ?? params.runtimeWebSearch?.providerConfigured,
  );
  if (!runtimeProviderId) {
    return undefined;
  }
  const configuredProviderId =
    params.search && "provider" in params.search
      ? normalizeOptionalLowercaseString(params.search.provider)
      : undefined;
  if (configuredProviderId) {
    const configuredProvider = params.providers?.find((entry) => entry.id === configuredProviderId);
    return configuredProvider?.id === runtimeProviderId ? runtimeProviderId : undefined;
  }
  if (params.runtimeWebSearch?.providerSource === "configured") {
    return runtimeProviderId;
  }
  const provider = params.providers?.find((entry) => entry.id === runtimeProviderId);
  return provider &&
    hasImplicitProviderSelectionSignal(provider, params.config, params.search, params.agentDir)
    ? provider.id
    : undefined;
}

function resolveExplicitWebSearchProviderId(params: {
  search?: WebSearchConfig;
  runtimeWebSearch?: RuntimeWebSearchMetadata;
  providerId?: string;
  includeRuntimeSelection?: boolean;
}): string | undefined {
  const callerProviderId = normalizeOptionalLowercaseString(params.providerId);
  if (callerProviderId) {
    return callerProviderId;
  }

  if (params.includeRuntimeSelection && params.runtimeWebSearch?.providerSource === "configured") {
    const runtimeProviderId = normalizeOptionalLowercaseString(
      params.runtimeWebSearch.selectedProvider ?? params.runtimeWebSearch.providerConfigured,
    );
    if (runtimeProviderId) {
      return runtimeProviderId;
    }
  }

  const configuredProviderId =
    params.search && "provider" in params.search
      ? normalizeOptionalLowercaseString(params.search.provider)
      : undefined;
  if (configuredProviderId) {
    return configuredProviderId;
  }
  return undefined;
}

// ENG-21224: a separately-named, explicitly-configured recovery provider —
// see runWebSearch below for how it's used once candidates are loaded. Reads
// it ahead of that so the provider-load SCOPE (just below) can also account
// for it: scoping candidate-loading to only the primary's owning plugin would
// otherwise silently filter the fallback's plugin out before it ever reaches
// the candidate list, making the fallback a no-op whenever the primary has
// known manifest ownership (true for every bundled provider in production).
function resolveExplicitFallbackWebSearchProviderId(search?: WebSearchConfig): string | undefined {
  const raw = (search as Record<string, unknown> | undefined)?.fallbackProvider;
  if (typeof raw !== "string") {
    return undefined;
  }
  return normalizeLowercaseStringOrEmpty(raw) || undefined;
}

function resolveExplicitWebSearchProviderPluginIds(params: {
  config?: OpenClawConfig;
  search?: WebSearchConfig;
  runtimeWebSearch?: RuntimeWebSearchMetadata;
  providerId?: string;
  includeRuntimeSelection?: boolean;
}): readonly string[] | undefined {
  const providerId = resolveExplicitWebSearchProviderId(params);
  if (!providerId) {
    return undefined;
  }
  const requiredProviderIds = [providerId];
  const fallbackProviderId = resolveExplicitFallbackWebSearchProviderId(params.search);
  if (fallbackProviderId && fallbackProviderId !== providerId) {
    requiredProviderIds.push(fallbackProviderId);
  }
  const pluginIds: string[] = [];
  for (const id of requiredProviderIds) {
    const ownerPluginId = resolveManifestContractOwnerPluginId({
      config: params.config,
      contract: "webSearchProviders",
      value: id,
    });
    // Unknown ownership for ANY required provider (primary or fallback) means
    // we cannot safely narrow the load scope — fall back to loading every
    // provider (unscoped), the same safe default as the pre-existing
    // single-id behavior, rather than risk silently dropping one we were
    // explicitly told to load.
    if (!ownerPluginId) {
      return undefined;
    }
    pluginIds.push(ownerPluginId);
  }
  return pluginIds;
}

function resolveWebSearchProviderLoadScope(params: {
  config?: OpenClawConfig;
  search?: WebSearchConfig;
  runtimeWebSearch?: RuntimeWebSearchMetadata;
  providerId?: string;
  includeRuntimeSelection?: boolean;
}): { onlyPluginIds?: readonly string[] } {
  const onlyPluginIds = resolveExplicitWebSearchProviderPluginIds(params);
  return onlyPluginIds ? { onlyPluginIds } : {};
}

type WebSearchRequestContext = {
  config?: OpenClawConfig;
  search?: WebSearchConfig;
  runtimeWebSearch?: RuntimeWebSearchMetadata;
};

function resolveWebSearchRequestContext(
  options?: Pick<
    ResolveWebSearchDefinitionParams,
    "config" | "preferInputConfig" | "runtimeWebSearch"
  >,
): WebSearchRequestContext {
  const config = resolveWebSearchRuntimeConfig({
    config: options?.config,
    preferInputConfig: options?.preferInputConfig,
  });
  return {
    config,
    search: resolveSearchConfig(config),
    runtimeWebSearch: options?.runtimeWebSearch ?? getActiveRuntimeWebToolsMetadata()?.search,
  };
}

function loadSortedWebSearchProviders(
  params: WebSearchRequestContext & {
    providerId?: string;
    preferRuntimeProviders?: boolean;
  },
): PluginWebSearchProviderEntry[] {
  const loadScope = resolveWebSearchProviderLoadScope({
    config: params.config,
    search: params.search,
    runtimeWebSearch: params.runtimeWebSearch,
    providerId: params.providerId,
    includeRuntimeSelection: Boolean(params.preferRuntimeProviders),
  });
  return sortWebSearchProvidersForAutoDetect(
    params.preferRuntimeProviders
      ? resolveRuntimeWebSearchProviders({
          config: params.config,
          ...loadScope,
        })
      : resolvePluginWebSearchProviders({
          config: params.config,
          ...loadScope,
        }),
  );
}

function resolveWebSearchCandidates(
  options?: ResolveWebSearchDefinitionParams,
): PluginWebSearchProviderEntry[] {
  const { config, search, runtimeWebSearch } = resolveWebSearchRequestContext(options);
  if (!resolveWebSearchEnabled({ search, sandboxed: options?.sandboxed })) {
    return [];
  }

  const providers = loadSortedWebSearchProviders({
    config,
    search,
    runtimeWebSearch,
    providerId: options?.providerId,
    preferRuntimeProviders: options?.preferRuntimeProviders,
  }).filter(Boolean);
  if (providers.length === 0) {
    return [];
  }

  const preferredIds = uniqueStrings(
    [
      options?.providerId,
      resolveRuntimePreferredWebSearchProviderId({
        config,
        search,
        runtimeWebSearch,
        providers,
        agentDir: options?.agentDir,
      }),
      resolveWebSearchProviderId({ config, agentDir: options?.agentDir, search, providers }),
    ].filter((value): value is string => Boolean(value)),
  );

  const explicitProviderId = options?.providerId?.trim();
  if (explicitProviderId && !providers.some((entry) => entry.id === explicitProviderId)) {
    throw new Error(`Unknown web_search provider "${explicitProviderId}".`);
  }
  const explicitSelection = hasExplicitWebSearchSelection({
    search,
    runtimeWebSearch,
    providerId: options?.providerId,
    providers,
  });
  if (preferredIds.length === 0 && !explicitSelection) {
    return [];
  }
  const fallbackProviders = explicitSelection
    ? providers
    : providers.filter((provider) =>
        hasImplicitProviderSelectionSignal(provider, config, search, options?.agentDir),
      );

  const orderedProviders = [
    ...preferredIds
      .map((id) => providers.find((entry) => entry.id === id))
      .filter((entry): entry is PluginWebSearchProviderEntry => Boolean(entry)),
    ...fallbackProviders.filter((entry) => !preferredIds.includes(entry.id)),
  ];
  return orderedProviders;
}

function hasExplicitWebSearchSelection(params: {
  search?: WebSearchConfig;
  runtimeWebSearch?: RuntimeWebSearchMetadata;
  providerId?: string;
  providers?: PluginWebSearchProviderEntry[];
}): boolean {
  if (params.providerId?.trim()) {
    return true;
  }
  const availableProviderIds = new Set(
    (params.providers ?? []).map((provider) => normalizeLowercaseStringOrEmpty(provider.id)),
  );
  const configuredProviderId =
    params.search && "provider" in params.search && typeof params.search.provider === "string"
      ? normalizeLowercaseStringOrEmpty(params.search.provider)
      : "";
  if (configuredProviderId && availableProviderIds.has(configuredProviderId)) {
    return true;
  }
  const runtimeConfiguredId = normalizeOptionalLowercaseString(
    params.runtimeWebSearch?.selectedProvider ?? params.runtimeWebSearch?.providerConfigured,
  );
  if (
    params.runtimeWebSearch?.providerSource === "configured" &&
    runtimeConfiguredId &&
    availableProviderIds.has(runtimeConfiguredId)
  ) {
    return true;
  }
  return false;
}

function isStructuredAvailabilityError(result: unknown): result is { error: string } {
  if (!result || typeof result !== "object" || !("error" in result)) {
    return false;
  }
  const error = (result as { error?: unknown }).error;
  return typeof error === "string" && /^missing_[a-z0-9_]*api_key$/i.test(error);
}

/** Executes web_search with fallback when selection was not explicit. */
export async function runWebSearch(params: RunWebSearchParams): Promise<RunWebSearchResult> {
  const config = resolveWebSearchRuntimeConfig({
    config: params.config,
    preferInputConfig: params.preferInputConfig,
  });
  const search = resolveSearchConfig(config);
  const runtimeWebSearch = params.runtimeWebSearch ?? getActiveRuntimeWebToolsMetadata()?.search;
  const candidates = resolveWebSearchCandidates({
    ...params,
    config,
    runtimeWebSearch,
    preferRuntimeProviders: params.preferRuntimeProviders ?? true,
  });
  if (candidates.length === 0) {
    throw new Error("web_search is disabled or no provider is available.");
  }
  const allowFallback = !hasExplicitWebSearchSelection({
    search,
    runtimeWebSearch,
    providerId: params.providerId,
    providers: candidates,
  });
  // ENG-21224 review: fallbackProvider is an operator-configured safety net
  // for the operator-configured PRIMARY (tools.web.search.provider) — it must
  // not also silently kick in for a caller-supplied providerId override (e.g.
  // `openclaw capability web search --provider <id>`, a diagnostic command
  // whose entire purpose is observing exactly that one provider's real
  // behavior). Masking that provider's failure with a different provider's
  // success there would defeat the command, not help it.
  const explicitFallbackId = params.providerId
    ? undefined
    : resolveExplicitFallbackWebSearchProviderId(search);
  let lastError: unknown;
  let sawUnavailableProvider = false;

  for (const candidate of candidates) {
    try {
      const definition = candidate.createTool({
        config,
        agentDir: params.agentDir,
        searchConfig: search as Record<string, unknown> | undefined,
        runtimeMetadata: runtimeWebSearch,
      });
      if (!definition) {
        if (!allowFallback) {
          throw new Error(`web_search provider "${candidate.id}" is not available.`);
        }
        sawUnavailableProvider = true;
        continue;
      }
      const executed = await definition.execute(params.args, { signal: params.signal });
      if (allowFallback && isStructuredAvailabilityError(executed)) {
        // Some providers report missing credentials as structured tool output.
        // Treat that like unavailable only during auto-detected fallback.
        lastError = new Error(`web_search provider "${candidate.id}" returned ${executed.error}`);
        continue;
      }
      return {
        provider: candidate.id,
        result: executed,
      };
    } catch (error) {
      if (!allowFallback) {
        // One narrow recovery attempt at a separately-named, explicitly
        // configured fallback — not a reopening of auto-detect fallback.
        if (explicitFallbackId && explicitFallbackId !== candidate.id) {
          const fallbackCandidate = candidates.find((entry) => entry.id === explicitFallbackId);
          if (fallbackCandidate) {
            try {
              const fallbackDefinition = fallbackCandidate.createTool({
                config,
                agentDir: params.agentDir,
                searchConfig: search as Record<string, unknown> | undefined,
                runtimeMetadata: runtimeWebSearch,
              });
              if (fallbackDefinition) {
                const fallbackExecuted = await fallbackDefinition.execute(params.args, {
                  signal: params.signal,
                });
                // A fallback that reports its own failure as structured output
                // (e.g. a missing API key) did not actually recover anything —
                // fall through to the ORIGINAL primary error below, same as a
                // thrown fallback error.
                if (!isStructuredAvailabilityError(fallbackExecuted)) {
                  return { provider: fallbackCandidate.id, result: fallbackExecuted };
                }
              }
            } catch {
              // Fallback also failed — report the ORIGINAL primary error below,
              // not the fallback's, so operators still see the root cause.
            }
          }
        }
        throw error;
      }
      lastError = error;
    }
  }

  if (sawUnavailableProvider && lastError === undefined) {
    throw new Error("web_search is enabled but no provider is currently available.");
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
