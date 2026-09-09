// Browser Login Handoff state keyed by site, persisted through the plugin state store.
export const BROWSER_HANDOFF_STATE_NAMESPACE = "handoffs";
export const BROWSER_HANDOFF_STATE_MAX_ENTRIES = 512;
// Kept above tool.ts's MAX_TOTAL_WAIT_MS: a handoff can legitimately take
// well over an hour end-to-end, and this TTL silently sweeping the record
// first would dead-end action=status into "no pending handoff found"
// instead of ever re-checking boon-core.
export const BROWSER_HANDOFF_STATE_DEFAULT_TTL_MS = 4 * 60 * 60 * 1000;

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
  /** Number of "still pending" status checks so far; drives the recheck backoff. */
  checkCount?: number;
};

/** Normalize a site identifier into a stable, case-insensitive state key. */
export function browserHandoffStateKey(site: string): string {
  return site.trim().toLowerCase();
}

/**
 * Cron tag for this site's scheduled recheck turn. Cron tag names reject the
 * `:` delimiter (reserved for its own name encoding). Base64url-encode the
 * normalized site rather than substituting `:` for another character: a
 * naive substitution collides (`example.com:8080` and `example.com-8080`
 * would both produce the same tag), silently merging two sites' schedules.
 */
export function browserHandoffScheduleTag(site: string): string {
  return `handoff-${Buffer.from(browserHandoffStateKey(site)).toString("base64url")}`;
}
