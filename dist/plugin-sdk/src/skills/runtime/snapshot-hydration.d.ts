type SnapshotWithRuntimeSkills = {
    commandSkills?: unknown;
    resolvedSkills?: unknown;
};
type SnapshotRebuild<T extends SnapshotWithRuntimeSkills> = {
    commandSkills?: T["commandSkills"];
    resolvedSkills?: T["resolvedSkills"];
};
export declare function hydrateRuntimeSkills<T extends SnapshotWithRuntimeSkills>(snapshot: T, rebuild: () => SnapshotRebuild<T>): T;
export {};
