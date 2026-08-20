/**
 * Public SDK facade for registering a remote-CDP browser profile owned by the
 * bundled `browser` plugin, for use by sibling plugins that need to hand a
 * browser tool an attach-only session (e.g. after a login handoff).
 */
import {
  canLoadActivatedBundledPluginPublicSurface,
  tryLoadActivatedBundledPluginPublicSurfaceModuleSync,
} from "./facade-runtime.js";

export type RegisterRemoteCdpBrowserProfileResult =
  | { ok: true; name: string }
  | { ok: false; error: string };

type BrowserProfileMutationSurface = {
  registerRemoteCdpBrowserProfile: (params: {
    name: string;
    cdpUrl: string;
  }) => Promise<RegisterRemoteCdpBrowserProfileResult>;
  unregisterRemoteCdpBrowserProfile: (name: string) => Promise<void>;
};

let cachedBrowserProfileMutationSurface: BrowserProfileMutationSurface | undefined;

function loadBrowserProfileMutationSurface(): BrowserProfileMutationSurface | null {
  const request = {
    dirName: "browser",
    artifactBasename: "browser-profile-mutations.js",
  };
  if (!canLoadActivatedBundledPluginPublicSurface(request)) {
    return null;
  }
  if (!cachedBrowserProfileMutationSurface) {
    cachedBrowserProfileMutationSurface =
      tryLoadActivatedBundledPluginPublicSurfaceModuleSync<BrowserProfileMutationSurface>(
        request,
      ) ?? undefined;
  }
  return cachedBrowserProfileMutationSurface ?? null;
}

/** Register a remote-CDP browser profile when the browser plugin is active. */
export async function registerRemoteCdpBrowserProfile(params: {
  name: string;
  cdpUrl: string;
}): Promise<RegisterRemoteCdpBrowserProfileResult> {
  const surface = loadBrowserProfileMutationSurface();
  if (!surface) {
    return { ok: false, error: "browser plugin is not active" };
  }
  return await surface.registerRemoteCdpBrowserProfile(params);
}

/** Remove a previously registered browser profile when the browser plugin is active. */
export async function unregisterRemoteCdpBrowserProfile(name: string): Promise<void> {
  const surface = loadBrowserProfileMutationSurface();
  if (!surface) {
    return;
  }
  await surface.unregisterRemoteCdpBrowserProfile(name);
}
