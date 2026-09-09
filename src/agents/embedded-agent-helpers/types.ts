/** Context file passed into embedded agents as preloaded workspace content. */
export type EmbeddedContextFile = { path: string; content: string };

/** Closed reason codes used by model failover and retry classification. */
export type FailoverReason =
  | "auth"
  | "auth_permanent"
  | "format"
  | "rate_limit"
  | "overloaded"
  | "billing"
  | "server_error"
  | "timeout"
  | "model_not_found"
  | "session_expired"
  | "empty_response"
  | "no_error_details"
  /**
   * A CDN/WAF edge block (Cloudflare, Render) relayed by the gateway instead
   * of a real provider response. Content-based and deterministic — the same
   * request blocks on every model in the fallback ladder — so this is
   * terminal (surface_error, never rotate_profile/fallback_model) and must
   * never be treated like "auth" for auth-profile cooldown purposes.
   */
  | "edge_blocked"
  | "unclassified"
  | "unknown";
