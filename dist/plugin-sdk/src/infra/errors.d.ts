export declare function extractErrorCode(err: unknown): string | undefined;
export declare function readErrorName(err: unknown): string;
export declare function collectErrorGraphCandidates(err: unknown, resolveNested?: (current: Record<string, unknown>) => Iterable<unknown>): unknown[];
/**
 * Type guard for NodeJS.ErrnoException (any error with a `code` property).
 */
export declare function isErrno(err: unknown): err is NodeJS.ErrnoException;
/**
 * Check if an error has a specific errno code.
 */
export declare function hasErrnoCode(err: unknown, code: string): boolean;
export declare function formatErrorMessage(err: unknown): string;
/**
 * True when `error` (or any node in its cause/error graph) is the reply-session
 * initialization CAS conflict thrown by `src/auto-reply/reply/session.ts`. Channel
 * plugins use this to classify the error as retryable rather than a hard failure.
 */
export declare function isReplySessionInitializationConflictError(error: unknown): boolean;
/**
 * Render a non-Error `cause` value (string, number, plain object, etc.) for inclusion in
 * a flattened error chain. Returns `[object Object]`-free text without throwing.
 */
export declare function stringifyNonErrorCause(value: unknown): string;
export declare function toErrorObject(value: unknown, fallbackMessage: string): Error;
export declare function formatUncaughtError(err: unknown): string;
export type ErrorKind = "refusal" | "timeout" | "rate_limit" | "context_length" | "unknown";
export declare function detectErrorKind(err: unknown): ErrorKind | undefined;
