export declare const NPM_EXEC_OPTIONS_WITH_VALUE: Set<string>;
export declare const PNPM_OPTIONS_WITH_VALUE: Set<string>;
export declare const PNPM_CASE_SENSITIVE_OPTIONS_WITH_VALUE: Set<string>;
export declare const PNPM_FLAG_OPTIONS: Set<string>;
export declare const PNPM_DLX_OPTIONS_WITH_VALUE: Set<string>;
export declare function normalizePackageManagerExecToken(token: string): string;
export type PackageManagerExecInvocation = {
    kind: "not-package-manager";
} | {
    kind: "not-exec";
} | {
    kind: "unsafe-exec";
} | {
    kind: "unwrapped";
    argv: string[];
};
export declare function unwrapKnownPackageManagerExecInvocation(argv: string[]): string[] | null;
export declare function resolveKnownPackageManagerExecInvocation(argv: string[]): PackageManagerExecInvocation;
