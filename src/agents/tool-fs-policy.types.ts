/** Filesystem policy for agent tools that can touch local paths. */
export type ToolFsPolicy = {
  workspaceOnly: boolean;
  /**
   * Host read outside the workspace is permitted, so media tools may widen the
   * read allowlist to a referenced file's own directory. Absent means "no", so a
   * caller that does not resolve policy stays at the narrow default roots.
   */
  rootExpansionAllowed?: boolean;
};
