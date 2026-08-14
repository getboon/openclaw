// Snapshot hydration helpers merge saved runtime skill snapshots into live state.
type SnapshotWithRuntimeSkills = {
  commandSkills?: unknown;
  resolvedSkills?: unknown;
};

type SnapshotRebuild<T extends SnapshotWithRuntimeSkills> = {
  commandSkills?: T["commandSkills"];
  resolvedSkills?: T["resolvedSkills"];
};

// Parsed skill lists are runtime-only: session persistence keeps the lightweight
// catalog/prompt, while consumers that need concrete SKILL.md paths hydrate both
// prompt-visible and user-invocable skills from one fresh workspace scan.
export function hydrateRuntimeSkills<T extends SnapshotWithRuntimeSkills>(
  snapshot: T,
  rebuild: () => SnapshotRebuild<T>,
): T {
  if (snapshot.resolvedSkills !== undefined && snapshot.commandSkills !== undefined) {
    return snapshot;
  }
  const rebuilt = rebuild();
  return {
    ...snapshot,
    ...(snapshot.resolvedSkills === undefined ? { resolvedSkills: rebuilt.resolvedSkills } : {}),
    ...(snapshot.commandSkills === undefined ? { commandSkills: rebuilt.commandSkills } : {}),
  };
}
