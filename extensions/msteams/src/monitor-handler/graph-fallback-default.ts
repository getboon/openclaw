// Boon fork default for `channels.msteams.alwaysFetchGraphMessage`.
//
// Every Teams tenant in the Boon fleet observed the ENG-14349 Bot Framework
// stub-stripping regression — inbound activities arrive without the
// `<attachment id=...>` HTML stub AND without `reference`-typed entries even
// with RSC consent granted, so attachments silently vanish unless the Graph
// re-fetch path fires. The extra Graph round-trip per channel message is the
// price of correctness on this fleet; retires the host-local msteams SP-PATCH
// that gandalf-manager previously baked in via `scripts/fleet-msteams5.22-bump.sh`.
//
// Upstream keeps the opt-in default because tenants where Bot Framework
// delivers the stub correctly should not pay per-message Graph latency; the
// fork does not have such tenants.
export const BOON_FORK_ALWAYS_FETCH_GRAPH_MESSAGE_DEFAULT = true;

export function resolveMSTeamsAlwaysFetchGraphMessage(configured: boolean | undefined): boolean {
  return configured ?? BOON_FORK_ALWAYS_FETCH_GRAPH_MESSAGE_DEFAULT;
}
