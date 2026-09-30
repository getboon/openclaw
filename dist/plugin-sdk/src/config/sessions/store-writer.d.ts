export type RunExclusiveSessionStoreWriteOptions = {
    reentrant?: boolean;
};
export declare function runExclusiveSessionStoreWrite<T>(storePath: string, fn: () => Promise<T>, opts?: RunExclusiveSessionStoreWriteOptions): Promise<T>;
