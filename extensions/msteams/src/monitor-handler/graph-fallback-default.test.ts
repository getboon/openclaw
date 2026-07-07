import { describe, expect, it } from "vitest";
import {
  BOON_FORK_ALWAYS_FETCH_GRAPH_MESSAGE_DEFAULT,
  resolveMSTeamsAlwaysFetchGraphMessage,
} from "./graph-fallback-default.js";

describe("resolveMSTeamsAlwaysFetchGraphMessage (Boon fork default-on)", () => {
  it("returns the fork default (true) when the operator has not set the flag", () => {
    // Retires the host-local msteams SP-PATCH — Boon fleet uniformly needs
    // Graph fallback because upstream Bot Framework strips attachment stubs.
    expect(resolveMSTeamsAlwaysFetchGraphMessage(undefined)).toBe(true);
    expect(BOON_FORK_ALWAYS_FETCH_GRAPH_MESSAGE_DEFAULT).toBe(true);
  });

  it("honors an explicit true override", () => {
    expect(resolveMSTeamsAlwaysFetchGraphMessage(true)).toBe(true);
  });

  it("honors an explicit false override so tenants can opt out per host", () => {
    expect(resolveMSTeamsAlwaysFetchGraphMessage(false)).toBe(false);
  });
});
