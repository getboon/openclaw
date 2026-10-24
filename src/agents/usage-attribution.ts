/**
 * Billing-only user identity for model-call usage attribution.
 *
 * Runs that have no inbound sender of their own (subagent children, plugin-started
 * runs) carry the originating user here so the LLM gateway can attribute their
 * token usage. This is deliberately separate from `senderId`/`senderName`: sender
 * identity drives command auth and sender-scoped tool policy, while this value only
 * feeds the usage headers on outbound model calls.
 */
import { normalizeOptionalString } from "@openclaw/normalization-core/string-coerce";

export type UsageAttribution = {
  /** Stable per-platform user id (the originating turn's sender id). */
  userId: string;
  /** Display name for the usage dashboard. */
  userName?: string;
  /** Originating platform (slack, msteams, boon-web, ...). */
  userSource?: string;
};

/** Normalizes an untrusted attribution value; requires a non-empty `userId`. */
export function normalizeUsageAttribution(value: unknown): UsageAttribution | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const userId = normalizeOptionalString(record.userId);
  if (!userId) {
    return undefined;
  }
  const userName = normalizeOptionalString(record.userName);
  const userSource = normalizeOptionalString(record.userSource);
  return {
    userId,
    ...(userName ? { userName } : {}),
    ...(userSource ? { userSource } : {}),
  };
}

/**
 * Resolves the attribution a run hands to the children it starts: its own inbound
 * sender when it has one, otherwise the attribution it inherited. The identity is
 * taken whole from one source so names/sources never mix across users.
 */
export function resolveRequesterUsageAttribution(params: {
  senderId?: string | null;
  senderName?: string | null;
  senderSource?: string | null;
  usageAttribution?: UsageAttribution | null;
}): UsageAttribution | undefined {
  return (
    normalizeUsageAttribution({
      userId: params.senderId,
      userName: params.senderName,
      userSource: params.senderSource,
    }) ?? normalizeUsageAttribution(params.usageAttribution)
  );
}
