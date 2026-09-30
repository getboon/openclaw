/**
 * Guarantees a history-preserving checkpoint exists at a terminal context-overflow
 * block. Normal overflow recovery only persists a checkpoint when a compaction
 * succeeds (see compact.ts); when compaction never ran or hard-failed there is no
 * restore point, and the only recovery would drop the whole session. This captures
 * one at the pre-block transcript state so branch/restore always carries history
 * forward.
 */
import type { OpenClawConfig } from "../../config/types.openclaw.js";
/**
 * Captures a fresh `overflow-block` checkpoint at the CURRENT transcript position
 * and returns its id, so branch/restore carries the full pre-block history forward.
 * We do not reuse an older checkpoint: its boundary is from an earlier compaction,
 * so branching there would discard everything since — the opposite of the
 * history-preserving guarantee. Returns `undefined` only when no
 * checkpoint could be established (best-effort; the surface degrades to honest
 * "no restore point" copy).
 */
export declare function ensureOverflowBlockCheckpoint(params: {
    config?: OpenClawConfig;
    sessionKey?: string;
    sessionId?: string;
    sessionFile?: string;
    agentId?: string;
    tokensBefore?: number;
}): Promise<string | undefined>;
