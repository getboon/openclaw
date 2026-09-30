/**
 * Bounded SSE / NDJSON stream reader guard.
 *
 * Wraps a `ReadableStreamDefaultReader<Uint8Array>` so the caller's existing
 * chunk-by-chunk parsing logic is unchanged, but accumulated bytes are tracked
 * against a hard cap. On overflow the underlying reader is cancelled and a
 * canonical error is thrown. Mirrors the `readResponseWithLimit` / bounded
 * JSON response pattern (see `src/agents/provider-http-errors.ts`).
 *
 * Internal helper for now. If extensions need it, promote to a plugin-SDK
 * subpath in a separate, dedicated PR with full SDK metadata sync.
 */
export type SseStreamOverflow = {
    size: number;
    maxBytes: number;
};
export type ReadSseStreamWithLimitOptions = {
    maxBytes: number;
    onOverflow?: (params: SseStreamOverflow) => Error;
};
export type SseByteGuard = {
    read(): Promise<ReadableStreamReadResult<Uint8Array>>;
    cancel(reason?: unknown): Promise<void>;
    totalBytes(): number;
    overflowed(): boolean;
    cancelled(): boolean;
};
export declare function createSseByteGuard(reader: ReadableStreamDefaultReader<Uint8Array>, opts: ReadSseStreamWithLimitOptions): SseByteGuard;
