/** Collects recursively referenced config include files without requiring a valid full config. */
export declare function collectIncludePathsRecursive(params: {
    configPath: string;
    parsed: unknown;
    env?: NodeJS.ProcessEnv;
    allowedRoots?: readonly string[];
}): Promise<string[]>;
