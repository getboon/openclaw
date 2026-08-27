/**
 * Chat-history text helpers for session tools.
 *
 * Removes tool messages and tool-plumbing-only assistant stubs, and extracts
 * sanitized assistant-visible text from stored messages.
 */
import { extractAssistantTextForPhase } from "../../shared/chat-message-content.js";
import { sanitizeAssistantVisibleTextWithProfile } from "../../shared/text/assistant-visible-text.js";
import { sanitizeUserFacingText } from "../embedded-agent-helpers/sanitize-user-facing-text.js";

export function stripToolMessages(messages: unknown[]): unknown[] {
  return messages.filter((msg) => {
    if (!msg || typeof msg !== "object") {
      return true;
    }
    const role = (msg as { role?: unknown }).role;
    return role !== "toolResult" && role !== "tool";
  });
}

function hasAssistantVisibleContentBlock(content: unknown): boolean {
  if (Array.isArray(content)) {
    return content.some((block) => {
      if (!block || typeof block !== "object") {
        return false;
      }
      const type = (block as { type?: unknown }).type;
      return type === "text" || type === "input_text" || type === "output_text" || type === "image";
    });
  }
  return typeof content === "string" && content.trim().length > 0;
}

/**
 * Drops assistant transcript entries that carry only thinking/tool-call
 * plumbing and no visible text or image. In message-tool-only delivery, the
 * real inference-turn record has no text block at all — the reply text lives
 * solely in a paired `delivery-mirror` entry written back after the send
 * (ENG-18919) — so these stubs add zero conversational value once
 * `stripToolMessages` has already dropped tool results, but still eat a
 * caller's requested history window ahead of the turns it actually asked
 * for. `delivery-mirror` entries are the only record of that text and must
 * never be dropped here.
 */
export function dropToolPlumbingOnlyAssistantMessages(messages: unknown[]): unknown[] {
  return messages.filter((msg) => {
    if (!msg || typeof msg !== "object") {
      return true;
    }
    const role = (msg as { role?: unknown }).role;
    if (role !== "assistant") {
      return true;
    }
    if ((msg as { model?: unknown }).model === "delivery-mirror") {
      return true;
    }
    return hasAssistantVisibleContentBlock((msg as { content?: unknown }).content);
  });
}

/**
 * Sanitize text content to strip tool call markers and thinking tags.
 * This ensures user-facing text doesn't leak internal tool representations.
 */
export function sanitizeTextContent(text: string): string {
  return sanitizeAssistantVisibleTextWithProfile(text, "history");
}

export function extractAssistantText(message: unknown): string | undefined {
  if (!message || typeof message !== "object") {
    return undefined;
  }
  if ((message as { role?: unknown }).role !== "assistant") {
    return undefined;
  }
  const joined =
    extractAssistantTextForPhase(message, {
      phase: "final_answer",
      sanitizeText: sanitizeTextContent,
      joinWith: "",
    }) ??
    extractAssistantTextForPhase(message, {
      sanitizeText: sanitizeTextContent,
      joinWith: "",
    });
  const stopReason = (message as { stopReason?: unknown }).stopReason;
  // Gate on stopReason only — a non-error response with a stale/background errorMessage
  // should not have its content rewritten with error templates (#13935).
  const errorContext = stopReason === "error";

  return joined ? sanitizeUserFacingText(joined, { errorContext }) : undefined;
}
