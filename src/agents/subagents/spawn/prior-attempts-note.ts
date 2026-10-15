import type { SubagentRunRecord } from "../registry/subagent-registry.types.js";

/**
 * ENG-21265 — Component A (checkpoint awareness). Builds the factual note injected
 * into a re-spawned child that shares its parent's workspace, telling it what prior
 * spawns in this session produced and how each ended. A run marked `ok` is a finished
 * deliverable; `error`/`timeout`/`unknown` may have left partial output worth resuming.
 *
 * Returns `null` (inject nothing) when the spawn does not inherit a shared workspace or
 * when there are no prior runs — so a fresh or sandboxed spawn never gets a misleading
 * "resume from nothing" note.
 */

const DEFAULT_MAX = 5;

/**
 * Formats the most-recent runs as `'name' (status), ...`. Shared by the resume note
 * (Component A) and the consecutive-failure-cap message (Component B) so the two stay
 * consistent.
 */
export function formatRunEntries(
  runs: readonly SubagentRunRecord[],
  max: number = DEFAULT_MAX,
): string {
  return runs
    .slice(-max)
    .map((r) => {
      const name = r.taskName?.trim() ? r.taskName : "(unlabeled)";
      const status = r.execution?.outcome?.status ?? "unknown";
      return `'${name}' (${status})`;
    })
    .join(", ");
}

export function buildPriorAttemptsNote(
  runs: readonly SubagentRunRecord[],
  opts: { inherited: boolean; max?: number },
): string | null {
  if (!opts.inherited) {
    return null;
  }
  if (!runs || runs.length === 0) {
    return null;
  }

  const max = opts.max ?? DEFAULT_MAX;
  const recent = runs.slice(-max);
  const count = recent.length;
  const noun = count === 1 ? "prior spawn" : "prior spawns";

  return (
    `This workspace has output from ${count} ${noun} this session: ` +
    `${formatRunEntries(recent, max)}. Check for reusable output before redoing work; a run ` +
    `marked 'ok' is a finished deliverable, while 'error'/'timeout' may have left partial output.`
  );
}
