import { beforeEach, describe, expect, it } from "vitest";
import {
  clearGoogleChatApprovalCardBindingsForTest,
  getGoogleChatApprovalCardBinding,
  registerGoogleChatManualApprovalFollowupSuppression,
  registerGoogleChatApprovalCardBinding,
  shouldSuppressGoogleChatManualExecApprovalFollowupPayload,
  shouldSuppressGoogleChatManualExecApprovalFollowupText,
} from "./approval-card-actions.js";

const approvalId = "12345678-1234-1234-1234-123456789012";
type TestExecApprovalDecision = "allow-once" | "allow-always" | "deny";
let tokenCounter = 0;

function registerExecApprovalCard(overrides?: {
  approvalId?: string;
  expiresAtMs?: number;
  allowedDecisions?: readonly TestExecApprovalDecision[];
}): void {
  registerGoogleChatApprovalCardBinding({
    token: `token-${tokenCounter++}`,
    accountId: "default",
    approvalId: overrides?.approvalId ?? approvalId,
    approvalKind: "exec",
    decision: "allow-once",
    allowedDecisions: overrides?.allowedDecisions ?? ["allow-once", "deny"],
    spaceName: "spaces/AAA",
    messageName: "spaces/AAA/messages/msg-1",
    expiresAtMs: overrides?.expiresAtMs ?? Date.now() + 60_000,
  });
}

describe("Google Chat approval card action registry", () => {
  beforeEach(() => {
    clearGoogleChatApprovalCardBindingsForTest();
    tokenCounter = 0;
  });

  it("suppresses manual exec approval follow-up text for an active native card", () => {
    registerExecApprovalCard();

    expect(
      shouldSuppressGoogleChatManualExecApprovalFollowupText(
        `I need approval.\nReply with:\n/approve ${approvalId.slice(0, 8)} allow-once`,
      ),
    ).toBe(true);
    expect(
      shouldSuppressGoogleChatManualExecApprovalFollowupText(
        `Run this if needed: \`/approve ${approvalId} deny\``,
      ),
    ).toBe(true);
  });

  it("suppresses manual exec approval follow-up text after native delivery before token binding", () => {
    registerGoogleChatManualApprovalFollowupSuppression({
      approvalId,
      approvalKind: "exec",
      allowedDecisions: ["allow-once", "deny"],
      expiresAtMs: Date.now() + 60_000,
    });

    expect(
      shouldSuppressGoogleChatManualExecApprovalFollowupText(
        `Please reply with:\n/approve ${approvalId.slice(0, 8)} allow-once`,
      ),
    ).toBe(true);
  });

  it("keeps unrelated, expired, and non-sendable approval text visible", () => {
    registerExecApprovalCard({ expiresAtMs: Date.now() - 1 });
    expect(
      shouldSuppressGoogleChatManualExecApprovalFollowupText(
        `/approve ${approvalId.slice(0, 8)} allow-once`,
      ),
    ).toBe(false);

    clearGoogleChatApprovalCardBindingsForTest();
    registerExecApprovalCard();
    expect(
      shouldSuppressGoogleChatManualExecApprovalFollowupText("/approve deadbeef allow-once"),
    ).toBe(false);
    expect(
      shouldSuppressGoogleChatManualExecApprovalFollowupText(`/approve ${approvalId} nope`),
    ).toBe(false);
  });

  it("suppresses only text-only manual approval follow-up payloads", () => {
    registerExecApprovalCard();

    expect(
      shouldSuppressGoogleChatManualExecApprovalFollowupPayload({
        text: `/approve ${approvalId.slice(0, 8)} allow-once`,
      }),
    ).toBe(true);
    expect(
      shouldSuppressGoogleChatManualExecApprovalFollowupPayload({
        text: `/approve ${approvalId.slice(0, 8)} allow-once`,
        mediaUrl: "https://example.test/image.png",
      }),
    ).toBe(false);
    expect(
      shouldSuppressGoogleChatManualExecApprovalFollowupPayload({
        text: `/approve ${approvalId.slice(0, 8)} allow-once`,
        channelData: { execApproval: { approvalId } },
      }),
    ).toBe(true);
    expect(
      shouldSuppressGoogleChatManualExecApprovalFollowupPayload({
        text: `/approve ${approvalId.slice(0, 8)} allow-once`,
        presentation: { blocks: [] },
      }),
    ).toBe(false);
  });

  it("evicts oldest approval card bindings once the cache exceeds its cap", () => {
    const firstToken = "token-first";
    registerGoogleChatApprovalCardBinding({
      token: firstToken,
      accountId: "default",
      approvalId: "approval-first",
      approvalKind: "exec",
      decision: "allow-once",
      allowedDecisions: ["allow-once", "deny"],
      spaceName: "spaces/AAA",
      messageName: "spaces/AAA/messages/msg-1",
      expiresAtMs: Date.now() + 60_000,
    });
    expect(getGoogleChatApprovalCardBinding(firstToken)).not.toBeNull();

    for (let i = 1; i <= 1024; i += 1) {
      registerGoogleChatApprovalCardBinding({
        token: `token-fill-${i}`,
        accountId: "default",
        approvalId: `approval-fill-${i}`,
        approvalKind: "exec",
        decision: "allow-once",
        allowedDecisions: ["allow-once", "deny"],
        spaceName: "spaces/AAA",
        messageName: `spaces/AAA/messages/msg-${i}`,
        expiresAtMs: Date.now() + 60_000,
      });
    }

    expect(getGoogleChatApprovalCardBinding(firstToken)).toBeNull();
    expect(getGoogleChatApprovalCardBinding("token-fill-1024")).not.toBeNull();
  });

  it("clears the orphaned suppression when its only card binding is evicted", () => {
    const firstToken = "token-first";
    const firstApprovalId = "approval-first";
    registerGoogleChatApprovalCardBinding({
      token: firstToken,
      accountId: "default",
      approvalId: firstApprovalId,
      approvalKind: "exec",
      decision: "allow-once",
      allowedDecisions: ["allow-once", "deny"],
      spaceName: "spaces/AAA",
      messageName: "spaces/AAA/messages/msg-1",
      expiresAtMs: Date.now() + 60_000,
    });
    expect(
      shouldSuppressGoogleChatManualExecApprovalFollowupText(
        `/approve ${firstApprovalId} allow-once`,
      ),
    ).toBe(true);

    for (let i = 1; i <= 1024; i += 1) {
      registerGoogleChatApprovalCardBinding({
        token: `token-fill-${i}`,
        accountId: "default",
        approvalId: `approval-fill-${i}`,
        approvalKind: "exec",
        decision: "allow-once",
        allowedDecisions: ["allow-once", "deny"],
        spaceName: "spaces/AAA",
        messageName: `spaces/AAA/messages/msg-${i}`,
        expiresAtMs: Date.now() + 60_000,
      });
    }

    expect(getGoogleChatApprovalCardBinding(firstToken)).toBeNull();
    // Without the fix, this stays suppressed forever: the card is gone (token
    // unknown) but its orphaned suppression entry keeps hiding the /approve text.
    expect(
      shouldSuppressGoogleChatManualExecApprovalFollowupText(
        `/approve ${firstApprovalId} allow-once`,
      ),
    ).toBe(false);
  });

  it("keeps the suppression when another live binding still covers the approval", () => {
    const sharedApprovalId = "approval-shared";
    const firstToken = "token-first";
    registerGoogleChatApprovalCardBinding({
      token: firstToken,
      accountId: "default",
      approvalId: sharedApprovalId,
      approvalKind: "exec",
      decision: "allow-once",
      allowedDecisions: ["allow-once", "deny"],
      spaceName: "spaces/AAA",
      messageName: "spaces/AAA/messages/msg-1",
      expiresAtMs: Date.now() + 60_000,
    });
    registerGoogleChatApprovalCardBinding({
      token: "token-second",
      accountId: "default",
      approvalId: sharedApprovalId,
      approvalKind: "exec",
      decision: "allow-once",
      allowedDecisions: ["allow-once", "deny"],
      spaceName: "spaces/BBB",
      messageName: "spaces/BBB/messages/msg-1",
      expiresAtMs: Date.now() + 60_000,
    });

    // Two bindings (first + second) already exist, so 1023 more fills exactly
    // exceeds the 1024 cap by one, evicting only the oldest ("first").
    for (let i = 1; i <= 1023; i += 1) {
      registerGoogleChatApprovalCardBinding({
        token: `token-fill-${i}`,
        accountId: "default",
        approvalId: `approval-fill-${i}`,
        approvalKind: "exec",
        decision: "allow-once",
        allowedDecisions: ["allow-once", "deny"],
        spaceName: "spaces/AAA",
        messageName: `spaces/AAA/messages/msg-${i}`,
        expiresAtMs: Date.now() + 60_000,
      });
    }

    expect(getGoogleChatApprovalCardBinding(firstToken)).toBeNull();
    expect(getGoogleChatApprovalCardBinding("token-second")).not.toBeNull();
    expect(
      shouldSuppressGoogleChatManualExecApprovalFollowupText(
        `/approve ${sharedApprovalId} allow-once`,
      ),
    ).toBe(true);
  });

  it("evicts oldest manual approval follow-up suppressions once the cache exceeds its cap", () => {
    const firstApprovalId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    registerGoogleChatManualApprovalFollowupSuppression({
      approvalId: firstApprovalId,
      approvalKind: "exec",
      allowedDecisions: ["allow-once", "deny"],
      expiresAtMs: Date.now() + 60_000,
    });
    expect(
      shouldSuppressGoogleChatManualExecApprovalFollowupText(
        `/approve ${firstApprovalId.slice(0, 8)} allow-once`,
      ),
    ).toBe(true);

    for (let i = 1; i <= 1024; i += 1) {
      registerGoogleChatManualApprovalFollowupSuppression({
        approvalId: `${i.toString().padStart(8, "0")}-aaaa-aaaa-aaaa-aaaaaaaaaaaa`,
        approvalKind: "exec",
        allowedDecisions: ["allow-once", "deny"],
        expiresAtMs: Date.now() + 60_000,
      });
    }

    expect(
      shouldSuppressGoogleChatManualExecApprovalFollowupText(
        `/approve ${firstApprovalId.slice(0, 8)} allow-once`,
      ),
    ).toBe(false);
    expect(
      shouldSuppressGoogleChatManualExecApprovalFollowupText(
        `/approve ${"1024".padStart(8, "0")} allow-once`,
      ),
    ).toBe(true);
  });
});
