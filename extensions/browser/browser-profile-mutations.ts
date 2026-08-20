import {
  createBrowserProfileConfig,
  deleteBrowserProfileConfig,
} from "./src/browser/config-mutations.js";
import { resolveBrowserConfig } from "./src/browser/config.js";
/**
 * Public surface for registering/removing a remote-CDP browser profile from a
 * sibling plugin. `browser.profiles.*` is core-owned and `.strict()`, and the
 * extensions boundary forbids importing another extension's `src/**` — this
 * is the sanctioned seam (loaded via the plugin-sdk facade loader) instead of
 * a direct cross-extension import.
 */
import { formatErrorMessage } from "./src/infra/errors.js";

export type RegisterRemoteCdpBrowserProfileResult =
  | { ok: true; name: string }
  | { ok: false; error: string };

/** Register a remote-CDP browser profile (attach-only, no local launch) under `name`. */
export async function registerRemoteCdpBrowserProfile(params: {
  name: string;
  cdpUrl: string;
}): Promise<RegisterRemoteCdpBrowserProfileResult> {
  try {
    const profile = await createBrowserProfileConfig({
      name: params.name,
      resolved: resolveBrowserConfig(undefined, undefined),
      parsedCdpUrl: params.cdpUrl,
      driver: "existing-session",
    });
    if (!profile) {
      return { ok: false, error: "profile mutation returned no result" };
    }
    return { ok: true, name: params.name };
  } catch (err) {
    return { ok: false, error: formatErrorMessage(err) };
  }
}

/** Remove a previously registered browser profile by name. */
export async function unregisterRemoteCdpBrowserProfile(name: string): Promise<void> {
  await deleteBrowserProfileConfig(name);
}
