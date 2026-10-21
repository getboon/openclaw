/**
 * Builds tool run context passed to embedded-agent tool handlers.
 */
import {
  freezeDiagnosticTraceContext,
  type DiagnosticTraceContext,
} from "../../../infra/diagnostic-trace-context.js";
import {
  resolveRequesterUsageAttribution,
  type UsageAttribution,
} from "../../usage-attribution.js";
import type { EmbeddedRunTrigger } from "./params.js";

/**
 * Builds the stable tool-run context forwarded into an embedded-attempt execution.
 */
export function buildEmbeddedAttemptToolRunContext(params: {
  trigger?: EmbeddedRunTrigger;
  jobId?: string;
  memoryFlushWritePath?: string;
  toolsAllow?: string[];
  trace?: DiagnosticTraceContext;
  senderId?: string | null;
  senderName?: string | null;
  senderSource?: string | null;
  usageAttribution?: UsageAttribution;
}): {
  trigger?: EmbeddedRunTrigger;
  jobId?: string;
  memoryFlushWritePath?: string;
  runtimeToolAllowlist?: string[];
  trace?: DiagnosticTraceContext;
  requesterUsageAttribution?: UsageAttribution;
} {
  const requesterUsageAttribution = resolveRequesterUsageAttribution(params);
  return {
    trigger: params.trigger,
    jobId: params.jobId,
    memoryFlushWritePath: params.memoryFlushWritePath,
    ...(params.toolsAllow ? { runtimeToolAllowlist: params.toolsAllow } : {}),
    // Freeze trace metadata at the attempt boundary so later mutable diagnostic updates do not
    // rewrite the facts attached to tool calls already in flight.
    ...(params.trace ? { trace: freezeDiagnosticTraceContext(params.trace) } : {}),
    // Children spawned from this run bill to the run's user (own sender, else inherited).
    ...(requesterUsageAttribution ? { requesterUsageAttribution } : {}),
  };
}
