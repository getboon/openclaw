// Cron delivery plan tests cover delivery target planning rules.
import { describe, expect, it } from "vitest";
import { hasExplicitCronDeliveryTarget, resolveCronDeliveryPlan } from "./delivery-plan.js";
import { makeCronJob } from "./delivery.test-helpers.js";

describe("resolveCronDeliveryPlan", () => {
  it("preserves explicit message target context for delivery.mode=none", () => {
    const plan = resolveCronDeliveryPlan(
      makeCronJob({
        name: "Cron Target Context",
        payload: { kind: "agentTurn", message: "send a message" },
        delivery: {
          mode: "none",
          channel: "telegram",
          to: "123:topic:42",
          threadId: 42,
          accountId: "ops",
        },
      }),
    );

    expect(plan).toEqual({
      mode: "none",
      channel: "telegram",
      to: "123:topic:42",
      threadId: 42,
      accountId: "ops",
      source: "delivery",
      requested: false,
    });
  });

  it("treats numeric zero thread id as an explicit target", () => {
    const plan = resolveCronDeliveryPlan(
      makeCronJob({
        delivery: {
          mode: "none",
          threadId: 0,
        },
      }),
    );

    expect(plan.threadId).toBe(0);
    expect(hasExplicitCronDeliveryTarget(plan)).toBe(true);
  });

  it("carries the captured turn source origin so delivery resolution can pin it (ENG-14833)", () => {
    const plan = resolveCronDeliveryPlan(
      makeCronJob({
        payload: { kind: "agentTurn", message: "report progress" },
        delivery: {
          mode: "announce",
          channel: "last",
          turnSourceChannel: "msteams",
          turnSourceTo: "channel-x-id",
          turnSourceAccountId: "bot-a",
          turnSourceThreadId: "thread-123",
        },
      }),
    );

    expect(plan.turnSourceChannel).toBe("msteams");
    expect(plan.turnSourceTo).toBe("channel-x-id");
    expect(plan.turnSourceAccountId).toBe("bot-a");
    expect(plan.turnSourceThreadId).toBe("thread-123");
  });
});
