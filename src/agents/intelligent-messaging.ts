// ENG-16330 — Intelligent Messaging: outcome-aware channel surfacing.
//
// Problem: a backgrounded exec/tmux/process session that exits non-zero but which
// the agent RECOVERS from (the turn continues and produces a real answer) still
// renders "⚠️ 🧰 Process: <session-name> failed" to the channel — giving the user the
// wrong intuition ("the agent broke"). #53 (ENG-15627 §5b) fixed this for the process
// kill/remove case; this extends outcome-awareness to the recovered-non-zero class.
//
// Design (docs/superpowers/specs/2026-07-20-intelligent-messaging-design.md):
//  - The model-facing `isToolResultError` semantics are UNCHANGED (the model must
//    still see the true non-zero exit). Only the CHANNEL-surfacing layer changes.
//  - Recoverable tool errors (exec/tmux/process bg) are BUFFERED per-turn instead of
//    emitted live. At turn close: if the turn succeeded, drop the failure badges and
//    emit a human-readable PATH TRAIL ("recovered X, continued with Y") with generated
//    session names sanitized. If the turn failed, flush the badges as real failures
//    (no regression of #53/#47/#48/#50). Terminal/non-recoverable errors
//    (message delivery, auth, quota) are surfaced IMMEDIATELY, never buffered.

import { normalizeOptionalLowercaseString } from "@openclaw/normalization-core/string-coerce";
import { readToolResultDetails, readToolResultStatus } from "./tool-result-error.js";

/** Tool classes whose non-terminal errors are commonly recovered mid-turn. */
const RECOVERABLE_TOOL_NAMES = new Set(["exec", "process", "tmux"]);

/**
 * Status/error signals that are terminal-ish and must reach the user promptly even
 * if the turn later "succeeds" — auth/quota/delivery gaps are not recovered work.
 */
const TERMINAL_ERROR_SIGNALS = [
  "allocation_exhausted",
  "quota",
  "unauthorized",
  "forbidden",
  "denied",
  "invalid_api_key",
  "authentication",
];

export type ToolSurfacingMode =
  | "passthrough" // not an error — nothing to decide
  | "immediate" // an error the user must see now (terminal / non-recoverable)
  | "buffer-recoverable"; // a recoverable error — hold for turn-close resolution

export interface ToolSurfacingInput {
  toolName: string;
  isToolError: boolean;
  result: unknown;
}

export interface ToolSurfacingDecision {
  mode: ToolSurfacingMode;
}

function looksTerminal(result: unknown): boolean {
  const details = readToolResultDetails(result);
  if (!details) {
    return false;
  }
  const haystacks: string[] = [];
  const err = details.error;
  if (typeof err === "string") {
    haystacks.push(err.toLowerCase());
  }
  const code = details.errorCode ?? details.code;
  if (typeof code === "string") {
    haystacks.push(code.toLowerCase());
  }
  const status = readToolResultStatus(result);
  if (status) {
    haystacks.push(status);
  }
  return haystacks.some((h) => TERMINAL_ERROR_SIGNALS.some((sig) => h.includes(sig)));
}

/**
 * Decide how a completed tool result should reach the channel. Pure — no side effects.
 */
export function classifyToolSurfacing(input: ToolSurfacingInput): ToolSurfacingDecision {
  if (!input.isToolError) {
    return { mode: "passthrough" };
  }
  const toolName = normalizeOptionalLowercaseString(input.toolName) ?? "";
  if (!RECOVERABLE_TOOL_NAMES.has(toolName)) {
    // e.g. message/delivery/auth tools — surface now.
    return { mode: "immediate" };
  }
  if (looksTerminal(input.result)) {
    return { mode: "immediate" };
  }
  return { mode: "buffer-recoverable" };
}

// --- generated-session-name sanitization ------------------------------------
// Backgrounded exec/process sessions get auto-generated `adjective-noun` names
// (e.g. "salty-shore", "quiet-harbor"). Those are meaningless to a user and must
// not appear in a user-facing status line. A name the agent/tooling set explicitly
// (contains a digit, 3+ segments, or a domain word) is passed through.
const GENERATED_NAME_RE = /^[a-z]+-[a-z]+$/;
const GENERIC_SESSION_PHRASE = "a background command";

export function sanitizeGeneratedSessionName(name: string | undefined): string {
  const n = (name ?? "").trim();
  if (n && GENERATED_NAME_RE.test(n)) {
    return GENERIC_SESSION_PHRASE;
  }
  return n || GENERIC_SESSION_PHRASE;
}

// --- per-turn buffer + turn-close resolution --------------------------------
export interface BufferedToolError {
  toolName: string;
  sessionName?: string;
  /** short human description of what the step was doing (from the tool call summary). */
  summary?: string;
}

export interface TurnResolution {
  /** failure badges to emit to the channel now (turn failed, or empty on success). */
  emitFailureBadges: BufferedToolError[];
  /** one-line path trail to emit on success, or undefined when nothing to say. */
  pathTrail?: string;
}

export interface TurnErrorBuffer {
  record(entry: BufferedToolError): void;
  size(): number;
  resolve(params: { turnSucceeded: boolean }): TurnResolution;
}

/**
 * Synthesize a single short, human-readable path-trail line from the recovered
 * steps. No raw generated session names; conveys recovery + continuation.
 */
export function synthesizePathTrail(entries: BufferedToolError[]): string | undefined {
  if (entries.length === 0) {
    return undefined;
  }
  const first = entries[0];
  const what = (first.summary ?? "").trim();
  const whatPhrase = what
    ? `a ${describeStep(what)}`
    : sanitizeGeneratedSessionName(first.sessionName);
  if (entries.length === 1) {
    return `🔧 Recovered from ${whatPhrase} and continued.`;
  }
  return `🔧 Recovered from ${entries.length} intermediate steps and continued.`;
}

/** Reduce a raw step summary/command to a short noun phrase for the trail. */
function describeStep(summary: string): string {
  const s = summary.toLowerCase();
  if (s.includes("find") || s.includes("ls ") || s.includes("list")) {
    return "file lookup";
  }
  if (s.includes("mkdir") || s.includes("touch") || s.includes("write")) {
    return "file setup step";
  }
  if (s.includes("pdf") || s.includes("page") || s.includes("render")) {
    return "document step";
  }
  return "background step";
}

export function createTurnErrorBuffer(): TurnErrorBuffer {
  const entries: BufferedToolError[] = [];
  return {
    record(entry) {
      entries.push(entry);
    },
    size() {
      return entries.length;
    },
    resolve({ turnSucceeded }) {
      if (!turnSucceeded) {
        // Turn genuinely failed → flush buffered errors as real failure badges.
        return { emitFailureBadges: [...entries] };
      }
      // Turn succeeded → hide the recovered-error badges; emit a path trail instead.
      return { emitFailureBadges: [], pathTrail: synthesizePathTrail(entries) };
    },
  };
}
