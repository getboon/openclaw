import { AsyncLocalStorage } from "node:async_hooks";
import { resolveGlobalSingleton } from "../../../shared/global-singleton.js";

// Stream cut-off retries spent in one execution (see stream-cutoff-retry.ts). Model fallback
// re-enters the runner once per candidate model, so runWithModelFallback opens one budget scope
// per execution and every candidate shares it: one retry per execution, not one per model.
// Scoped by execution rather than keyed by runId because some callers (cron, CLI) reuse the
// session id as runId across executions.
type StreamCutoffRetryBudget = { used: number };
const BUDGET_SCOPE_KEY = Symbol.for("openclaw.embeddedAgent.streamCutoffRetryBudget");

// Global singleton so duplicate module instances (bundle chunks) share one scope.
function budgetScope() {
  return resolveGlobalSingleton<AsyncLocalStorage<StreamCutoffRetryBudget>>(
    BUDGET_SCOPE_KEY,
    () => new AsyncLocalStorage<StreamCutoffRetryBudget>(),
  );
}

export function withStreamCutoffRetryBudget<T>(fn: () => Promise<T>): Promise<T> {
  return budgetScope().run({ used: 0 }, fn);
}

/** The current execution's budget; a caller outside any scope gets a fresh one. */
export function resolveStreamCutoffRetryBudget(): StreamCutoffRetryBudget {
  return budgetScope().getStore() ?? { used: 0 };
}
