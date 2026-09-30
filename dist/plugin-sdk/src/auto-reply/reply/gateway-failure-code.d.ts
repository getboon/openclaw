import type { FailoverReason } from "../../agents/embedded-agent-helpers/types.js";
import type { GatewayFailureCode } from "../../channels/message/message-origin.js";
/** Dominant FailoverReason across a FailoverError / FallbackSummaryError / raw error. */
export declare function resolveDominantFailoverReason(err: unknown): FailoverReason | undefined;
/**
 * True when the failure is a connectivity error reaching boon-core (the project
 * data / config API), as opposed to a model-provider transport error. Keyed on
 * the boon-core host plus a connection-class signal so it never fires on a
 * generic provider timeout.
 */
export declare function isBoonCoreUnreachableError(input: unknown): boolean;
/**
 * Resolve the deterministic gateway-failure code for a thrown run failure.
 * First match wins; the classification is total — any shape with no specific
 * signal falls through to `agent_failed_transient_after_retries`.
 */
export declare function resolveGatewayFailureCode(err: unknown): GatewayFailureCode;
