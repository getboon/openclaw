/**
 * Guarantees a history-preserving checkpoint exists at a terminal context-overflow
 * block. Normal overflow recovery only persists a checkpoint when a compaction
 * succeeds (see compact.ts); when compaction never ran or hard-failed there is no
 * restore point, and the only recovery would drop the whole session. This captures
 * one at the pre-block transcript state so branch/restore always carries history
 * forward (ENG-16323).
 */
import type { OpenClawConfig } from "../../config/types.openclaw.js";
import {
  captureCompactionCheckpointSnapshotAsync,
  persistSessionCompactionCheckpoint,
  readSessionLeafStateFromTranscriptAsync,
  resolveCompactionCheckpointTranscriptPosition,
} from "../../gateway/session-compaction-checkpoints.js";
import { log } from "./logger.js";

/**
 * Captures a fresh `overflow-block` checkpoint at the CURRENT transcript position
 * and returns its id, so branch/restore carries the full pre-block history forward.
 * We do not reuse an older checkpoint: its boundary is from an earlier compaction,
 * so branching there would discard everything since — the opposite of the
 * history-preserving guarantee (ENG-16323). Returns `undefined` only when no
 * checkpoint could be established (best-effort; the surface degrades to honest
 * "no restore point" copy).
 */
export async function ensureOverflowBlockCheckpoint(params: {
  config?: OpenClawConfig;
  sessionKey?: string;
  sessionId?: string;
  sessionFile?: string;
  agentId?: string;
  tokensBefore?: number;
}): Promise<string | undefined> {
  const { config, sessionKey, sessionId, sessionFile } = params;
  if (!config || !sessionKey || !sessionId || !sessionFile) {
    return undefined;
  }

  try {
    const snapshot = await captureCompactionCheckpointSnapshotAsync({ sessionFile });
    if (!snapshot) {
      log.warn(
        `[context-overflow-recovery] could not capture block checkpoint snapshot for sessionKey=${sessionKey}`,
      );
      return undefined;
    }

    const transcriptState = await readSessionLeafStateFromTranscriptAsync(sessionFile);
    const position = resolveCompactionCheckpointTranscriptPosition({ transcriptState });
    const checkpoint = await persistSessionCompactionCheckpoint({
      cfg: config,
      sessionKey,
      sessionId,
      reason: "overflow-block",
      snapshot,
      ...(typeof params.tokensBefore === "number" ? { tokensBefore: params.tokensBefore } : {}),
      postSessionFile: sessionFile,
      postLeafId: position.leafId,
      postEntryId: position.entryId,
    });
    return checkpoint?.checkpointId;
  } catch (err) {
    // Never let checkpoint capture fail the block itself — the run is already terminal.
    log.warn(
      `[context-overflow-recovery] failed to ensure block checkpoint for sessionKey=${sessionKey}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return undefined;
  }
}
