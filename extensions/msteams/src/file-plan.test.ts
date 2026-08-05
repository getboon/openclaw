// Msteams tests cover the shared outbound-file delivery resolver.
import { describe, expect, it } from "vitest";
import {
  buildMSTeamsSharePointFileLinkText,
  buildMSTeamsUndeliverableFileNotice,
  FILE_CONSENT_THRESHOLD_BYTES,
  resolveMSTeamsOutboundFilePlan,
} from "./file-plan.js";

describe("resolveMSTeamsOutboundFilePlan", () => {
  it("requires consent for a non-image in a personal chat", () => {
    expect(
      resolveMSTeamsOutboundFilePlan({
        conversationType: "personal",
        contentType: "application/pdf",
        bufferSize: 10,
        sharePointSiteId: undefined,
        hasTokenProvider: true,
      }),
    ).toEqual({ kind: "consent" });
  });

  it("requires consent for a large image in a personal chat", () => {
    expect(
      resolveMSTeamsOutboundFilePlan({
        conversationType: "personal",
        contentType: "image/png",
        bufferSize: FILE_CONSENT_THRESHOLD_BYTES,
        sharePointSiteId: undefined,
        hasTokenProvider: true,
      }),
    ).toEqual({ kind: "consent" });
  });

  it("inlines a small image in a personal chat", () => {
    expect(
      resolveMSTeamsOutboundFilePlan({
        conversationType: "personal",
        contentType: "image/png",
        bufferSize: 10,
        sharePointSiteId: undefined,
        hasTokenProvider: true,
      }),
    ).toEqual({ kind: "inline-image" });
  });

  it("inlines a small image in a group chat with no SharePoint site configured", () => {
    expect(
      resolveMSTeamsOutboundFilePlan({
        conversationType: "groupChat",
        contentType: "image/png",
        bufferSize: 10,
        sharePointSiteId: undefined,
        hasTokenProvider: true,
      }),
    ).toEqual({ kind: "inline-image" });
  });

  it("inlines a small image in a channel with no SharePoint site configured", () => {
    expect(
      resolveMSTeamsOutboundFilePlan({
        conversationType: "channel",
        contentType: "image/png",
        bufferSize: 10,
        sharePointSiteId: undefined,
        hasTokenProvider: true,
      }),
    ).toEqual({ kind: "inline-image" });
  });

  it("is undeliverable for a large image in a channel with no SharePoint site configured", () => {
    // Teams caps inline message size, so a large image with no upload path
    // has no safe delivery shape — silently inlining it could fail the send.
    expect(
      resolveMSTeamsOutboundFilePlan({
        conversationType: "channel",
        contentType: "image/png",
        bufferSize: FILE_CONSENT_THRESHOLD_BYTES,
        sharePointSiteId: undefined,
        hasTokenProvider: true,
      }),
    ).toEqual({ kind: "undeliverable", reason: "missing-sharepoint-site" });
  });

  it("uploads to SharePoint for a non-image in a group chat when a site is configured", () => {
    expect(
      resolveMSTeamsOutboundFilePlan({
        conversationType: "groupChat",
        contentType: "application/pdf",
        bufferSize: 10,
        sharePointSiteId: "contoso.sharepoint.com,guid1,guid2",
        hasTokenProvider: true,
      }),
    ).toEqual({ kind: "sharepoint-upload", siteId: "contoso.sharepoint.com,guid1,guid2" });
  });

  it("uploads to SharePoint for a non-image in a channel when a site is configured", () => {
    expect(
      resolveMSTeamsOutboundFilePlan({
        conversationType: "channel",
        contentType: "application/pdf",
        bufferSize: 10,
        sharePointSiteId: "contoso.sharepoint.com,guid1,guid2",
        hasTokenProvider: true,
      }),
    ).toEqual({ kind: "sharepoint-upload", siteId: "contoso.sharepoint.com,guid1,guid2" });
  });

  it("uploads a small image to SharePoint in a channel when a site is configured", () => {
    // A configured site must take priority over inlining even for images —
    // otherwise a working upload+link path silently regresses to inline
    // base64 with no permanent share link.
    expect(
      resolveMSTeamsOutboundFilePlan({
        conversationType: "channel",
        contentType: "image/png",
        bufferSize: 10,
        sharePointSiteId: "contoso.sharepoint.com,guid1,guid2",
        hasTokenProvider: true,
      }),
    ).toEqual({ kind: "sharepoint-upload", siteId: "contoso.sharepoint.com,guid1,guid2" });
  });

  it("uploads a large image to SharePoint in a channel when a site is configured", () => {
    expect(
      resolveMSTeamsOutboundFilePlan({
        conversationType: "channel",
        contentType: "image/png",
        bufferSize: FILE_CONSENT_THRESHOLD_BYTES,
        sharePointSiteId: "contoso.sharepoint.com,guid1,guid2",
        hasTokenProvider: true,
      }),
    ).toEqual({ kind: "sharepoint-upload", siteId: "contoso.sharepoint.com,guid1,guid2" });
  });

  it("is undeliverable for a non-image in a group chat with no SharePoint site configured", () => {
    expect(
      resolveMSTeamsOutboundFilePlan({
        conversationType: "groupChat",
        contentType: "application/pdf",
        bufferSize: 10,
        sharePointSiteId: undefined,
        hasTokenProvider: true,
      }),
    ).toEqual({ kind: "undeliverable", reason: "missing-sharepoint-site" });
  });

  it("is undeliverable for a non-image in a channel with no SharePoint site configured", () => {
    expect(
      resolveMSTeamsOutboundFilePlan({
        conversationType: "channel",
        contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        bufferSize: 10,
        sharePointSiteId: undefined,
        hasTokenProvider: true,
      }),
    ).toEqual({ kind: "undeliverable", reason: "missing-sharepoint-site" });
  });

  it("is undeliverable with a distinct reason when a site is configured but no token provider is available", () => {
    // Must not conflate this with "missing-sharepoint-site" — the site IS
    // configured, so telling an admin to configure it would misdiagnose the
    // real problem (the bot's Graph credentials aren't available).
    expect(
      resolveMSTeamsOutboundFilePlan({
        conversationType: "channel",
        contentType: "application/pdf",
        bufferSize: 10,
        sharePointSiteId: "contoso.sharepoint.com,guid1,guid2",
        hasTokenProvider: false,
      }),
    ).toEqual({ kind: "undeliverable", reason: "missing-token-provider" });
  });

  it("still inlines a small image when a site is configured but no token provider is available", () => {
    // Inline base64 delivery needs neither a site nor a token provider — a
    // small image stays deliverable regardless of why the upload path is
    // unusable, instead of turning a working delivery into an error notice.
    expect(
      resolveMSTeamsOutboundFilePlan({
        conversationType: "channel",
        contentType: "image/png",
        bufferSize: 10,
        sharePointSiteId: "contoso.sharepoint.com,guid1,guid2",
        hasTokenProvider: false,
      }),
    ).toEqual({ kind: "inline-image" });
  });

  it("is undeliverable with the token-provider reason for a large image when a site is configured but no token provider", () => {
    expect(
      resolveMSTeamsOutboundFilePlan({
        conversationType: "channel",
        contentType: "image/png",
        bufferSize: FILE_CONSENT_THRESHOLD_BYTES,
        sharePointSiteId: "contoso.sharepoint.com,guid1,guid2",
        hasTokenProvider: false,
      }),
    ).toEqual({ kind: "undeliverable", reason: "missing-token-provider" });
  });
});

describe("buildMSTeamsUndeliverableFileNotice", () => {
  it("includes the source URL when the original media reference was remote", () => {
    const notice = buildMSTeamsUndeliverableFileNotice({
      fileName: "proposal.xlsx",
      reason: "missing-sharepoint-site",
      sourceUrl: "https://app.getboon.ai/projects/123/proposal.xlsx",
    });
    expect(notice).toContain('"proposal.xlsx"');
    expect(notice).toContain("sharePointSiteId");
    expect(notice).toContain("https://app.getboon.ai/projects/123/proposal.xlsx");
  });

  it("omits any link when there is no source URL to fall back to", () => {
    const notice = buildMSTeamsUndeliverableFileNotice({
      fileName: "proposal.xlsx",
      reason: "missing-sharepoint-site",
    });
    expect(notice).not.toContain("http");
  });

  it("prefixes preceding text with a blank line separator", () => {
    const notice = buildMSTeamsUndeliverableFileNotice({
      fileName: "proposal.xlsx",
      reason: "missing-sharepoint-site",
      precedingText: "Here's what I found:",
    });
    expect(notice).toBe(
      'Here\'s what I found:\n\nI can\'t attach "proposal.xlsx" directly here — file attachments aren\'t set up for this channel/group yet (an admin needs to configure "sharePointSiteId").',
    );
  });

  it("uses a distinct message for a missing token provider, not the sharePointSiteId hint", () => {
    const notice = buildMSTeamsUndeliverableFileNotice({
      fileName: "proposal.xlsx",
      reason: "missing-token-provider",
    });
    expect(notice).toContain("Graph credentials");
    expect(notice).not.toContain("sharePointSiteId");
  });
});

describe("buildMSTeamsSharePointFileLinkText", () => {
  it("builds a bare link when there is no preceding text", () => {
    expect(
      buildMSTeamsSharePointFileLinkText({
        name: "proposal.xlsx",
        shareUrl: "https://sp.example.com/share/proposal.xlsx",
      }),
    ).toBe("📎 [proposal.xlsx](https://sp.example.com/share/proposal.xlsx)");
  });

  it("appends the link after preceding text with a blank line separator", () => {
    expect(
      buildMSTeamsSharePointFileLinkText({
        name: "proposal.xlsx",
        shareUrl: "https://sp.example.com/share/proposal.xlsx",
        precedingText: "here you go",
      }),
    ).toBe("here you go\n\n📎 [proposal.xlsx](https://sp.example.com/share/proposal.xlsx)");
  });
});
