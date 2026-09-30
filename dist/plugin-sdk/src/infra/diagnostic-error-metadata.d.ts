type DiagnosticErrorFailureKind = "aborted" | "connection_closed" | "connection_reset" | "terminated" | "timeout";
/** Returns a low-cardinality error category without trusting mutable `Error.name`. */
export declare function diagnosticErrorCategory(err: unknown): string;
/** Extracts a safe HTTP status code from own `status` or `statusCode` data properties. */
export declare function diagnosticHttpStatusCode(err: unknown): string | undefined;
/** Source classification of a 5xx model-call failure (see PluginHookModelCallEndedEvent). */
export type Diagnostic5xxSource = "upstream_provider_5xx" | "gateway_origin_5xx";
/**
 * Classifies a 5xx model-call failure as upstream-provider vs gateway-origin
 * (ENG-16922), so an observer can page on them differently. Status-driven, NOT
 * text-driven — no free-text message regex (that fragility is what ENG-16815
 * deliberately removed). Returns undefined for a missing or non-5xx status.
 *
 * The split mirrors boon-llm-gateway's single-hop behavior: a real upstream 5xx
 * (Bedrock/Anthropic 500/503/529) is relayed verbatim, while the gateway only
 * *synthesizes* 502 for its own faults (chain exhausted, WAF/HTML block page,
 * no-response transport failure). So:
 *   - 502              -> gateway_origin_5xx (the gateway made the final call)
 *   - 500 / 503 / 529  -> upstream_provider_5xx (relayed provider outage)
 *   - other 5xx        -> gateway_origin_5xx (conservative: unknown => our infra)
 * A recognized upstream provider `error.type` (api_error/overloaded) forces the
 * upstream class even on an ambiguous status, breaking ties without regex.
 */
export declare function classify5xxSource(httpStatus: number | undefined, err?: unknown): Diagnostic5xxSource | undefined;
/** Classifies transport-style failures without exposing raw error messages. */
export declare function diagnosticErrorFailureKind(err: unknown): DiagnosticErrorFailureKind | undefined;
/** Extracts and hashes bounded provider request ids so diagnostics never expose raw ids. */
export declare function diagnosticProviderRequestIdHash(err: unknown): string | undefined;
/** Formats a FailoverError-shaped error's reason/status/code/provider/model/rawError as a bounded, single-line log suffix. */
export declare function diagnosticFailoverDetailSuffix(err: unknown): string;
export {};
