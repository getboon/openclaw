// Agent media payload exports expose media roots and loaders for plugin-facing agent payloads.
export { getAgentScopedMediaLocalRoots } from "../media/local-roots.js";
// Canonical agent-scoped media access (roots + workspaceDir + host reader),
// not just roots. Reply-delivery paths that resolve local attachment paths
// should use this instead of getAgentScopedMediaLocalRoots alone, or a
// relative media path will resolve against the gateway cwd and fail the
// allowed-directory check instead of the agent workspace.
export { resolveAgentScopedOutboundMediaAccess } from "../media/read-capability.js";

/** Legacy agent media payload layout consumed by older agent adapters. */
export type AgentMediaPayload = {
  MediaPath?: string;
  MediaType?: string;
  MediaUrl?: string;
  MediaPaths?: string[];
  MediaUrls?: string[];
  MediaTypes?: string[];
};

/** Convert outbound media descriptors into the legacy agent payload field layout. */
export function buildAgentMediaPayload(
  mediaList: Array<{ path: string; contentType?: string | null }>,
): AgentMediaPayload {
  const first = mediaList[0];
  const mediaPaths = mediaList.map((media) => media.path);
  const mediaTypes = mediaList.map((media) => media.contentType).filter(Boolean) as string[];
  return {
    MediaPath: first?.path,
    MediaType: first?.contentType ?? undefined,
    MediaUrl: first?.path,
    MediaPaths: mediaPaths.length > 0 ? mediaPaths : undefined,
    MediaUrls: mediaPaths.length > 0 ? mediaPaths : undefined,
    MediaTypes: mediaTypes.length > 0 ? mediaTypes : undefined,
  };
}
