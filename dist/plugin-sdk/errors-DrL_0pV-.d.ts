//#region src/infra/errors.d.ts
declare function extractErrorCode(err: unknown): string | undefined;
declare function readErrorName(err: unknown): string;
declare function collectErrorGraphCandidates(err: unknown, resolveNested?: (current: Record<string, unknown>) => Iterable<unknown>): unknown[];
/**
 * Type guard for NodeJS.ErrnoException (any error with a `code` property).
 */
declare function isErrno(err: unknown): err is NodeJS.ErrnoException;
/**
 * Check if an error has a specific errno code.
 */
declare function hasErrnoCode(err: unknown, code: string): boolean;
declare function formatErrorMessage(err: unknown): string;
/**
 * True when `error` (or any node in its cause/error graph) is the reply-session
 * initialization CAS conflict thrown by `src/auto-reply/reply/session.ts`. Channel
 * plugins use this to classify the error as retryable rather than a hard failure.
 */
declare function isReplySessionInitializationConflictError(error: unknown): boolean;
/**
 * Render a non-Error `cause` value (string, number, plain object, etc.) for inclusion in
 * a flattened error chain. Returns `[object Object]`-free text without throwing.
 */
declare function stringifyNonErrorCause(value: unknown): string;
declare function toErrorObject(value: unknown, fallbackMessage: string): Error;
declare function formatUncaughtError(err: unknown): string;
type ErrorKind = "refusal" | "timeout" | "rate_limit" | "context_length" | "unknown";
declare function detectErrorKind(err: unknown): ErrorKind | undefined;
//#endregion
export { formatErrorMessage as a, isErrno as c, stringifyNonErrorCause as d, toErrorObject as f, extractErrorCode as i, isReplySessionInitializationConflictError as l, collectErrorGraphCandidates as n, formatUncaughtError as o, detectErrorKind as r, hasErrnoCode as s, ErrorKind as t, readErrorName as u };