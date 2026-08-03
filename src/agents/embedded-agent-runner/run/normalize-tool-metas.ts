/**
 * Normalizes the raw per-call tool metadata collected during a streaming attempt
 * into the shape consumed by `buildEmbeddedRunPayloads`.
 *
 * This lives in its own module so the field set it carries forward is covered by
 * a focused unit test. A previous regression dropped the per-call `errored` flag
 * here: the payload builder counts *completed* tools by that flag (to stay
 * accurate when MORE THAN ONE call errors in a turn), and the collector set it
 * correctly, but this normalization step in between silently discarded it —
 * forcing the buggy `toolMetas.length - 1` fallback that assumes a single
 * failure (cubic P2 review follow-up).
 */

/** Raw entry as collected by the subscription's tool-execution handler. */
export type RawToolMetaEntry = {
  toolName?: string;
  meta?: string;
  replaySafe?: boolean;
  errored?: boolean;
  status?: "blocked";
  asyncStarted?: boolean;
  asyncTaskRunId?: string;
  asyncTaskId?: string;
};

/** Normalized entry consumed by the payload/async-task layers. */
export type NormalizedToolMetaEntry = {
  toolName: string;
  meta?: string;
  replaySafe: boolean;
  errored?: boolean;
  status?: "blocked";
  asyncStarted?: true;
  asyncTaskRunId?: string;
  asyncTaskId?: string;
};

/**
 * Drop entries without a usable tool name, then carry forward the fields the
 * downstream payload builder and async-task waiter depend on — INCLUDING the
 * per-call `errored` outcome flag.
 */
export function normalizeToolMetas(
  toolMetas: readonly RawToolMetaEntry[],
): NormalizedToolMetaEntry[] {
  return toolMetas
    .filter(
      (entry): entry is RawToolMetaEntry & { toolName: string } =>
        typeof entry.toolName === "string" && entry.toolName.trim().length > 0,
    )
    .map((entry) => {
      const normalized: NormalizedToolMetaEntry = {
        toolName: entry.toolName,
        meta: entry.meta,
        replaySafe: entry.replaySafe === true,
      };
      // Preserve the per-call outcome so the non-terminal continuation status
      // counts only successfully-completed tools when more than one call errors.
      if (typeof entry.errored === "boolean") {
        normalized.errored = entry.errored;
      }
      // Carry the blocked/permission-denied marker forward so the audit trace
      // classifies it as `blocked` (not `ok`); the collector sets it for
      // approval-unavailable/never-started calls (ENG-16854).
      if (entry.status === "blocked") {
        normalized.status = "blocked";
      }
      if (entry.asyncStarted === true) {
        normalized.asyncStarted = true;
      }
      if (entry.asyncTaskRunId) {
        normalized.asyncTaskRunId = entry.asyncTaskRunId;
      }
      if (entry.asyncTaskId) {
        normalized.asyncTaskId = entry.asyncTaskId;
      }
      return normalized;
    });
}
