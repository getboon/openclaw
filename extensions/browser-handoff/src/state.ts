// Browser Login Handoff state keyed by site, persisted through the plugin state store.
export const BROWSER_HANDOFF_STATE_NAMESPACE = "handoffs";
export const BROWSER_HANDOFF_STATE_MAX_ENTRIES = 512;
// Anchor identity tokens observed at 15-minute expiry; give the human generous
// slack to complete login/2FA before the handoff record is swept.
export const BROWSER_HANDOFF_STATE_DEFAULT_TTL_MS = 60 * 60 * 1000;

export type BrowserHandoffStatus = "pending" | "ready" | "failed";

// `cdpUrl` is intentionally not part of the persisted record: it is fetched
// fresh from boon-core at attach time so nothing resembling a live connection
// credential sits at rest in plugin state.
export type BrowserHandoffRecord = {
  site: string;
  handoffToken: string;
  status: BrowserHandoffStatus;
  profileName?: string;
  createdAtMs: number;
};

/** Normalize a site identifier into a stable, case-insensitive state key. */
export function browserHandoffStateKey(site: string): string {
  return site.trim().toLowerCase();
}
