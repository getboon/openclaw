type JsonlSocketRequest<T> = {
    socketPath: string;
    requestLine: string;
    timeoutMs: number;
    accept: (msg: unknown) => T | null | undefined;
};
/**
 * Sends one JSONL request line, half-closes the write side, and waits for an accepted response line.
 */
declare function resolveJsonlSocketTimeoutMs(timeoutMs: number): number;
declare function requestJsonlSocketWithMaxLineBytes<T>(params: JsonlSocketRequest<T>, maxLineBytes: number): Promise<T | null>;
export declare function requestJsonlSocket<T>(params: JsonlSocketRequest<T>): Promise<T | null>;
export declare const testApi: {
    JSONL_SOCKET_MAX_LINE_BYTES: number;
    requestJsonlSocketWithMaxLineBytes: typeof requestJsonlSocketWithMaxLineBytes;
    resolveJsonlSocketTimeoutMs: typeof resolveJsonlSocketTimeoutMs;
};
export { testApi as __test__ };
