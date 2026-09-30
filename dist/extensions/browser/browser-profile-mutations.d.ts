//#region extensions/browser/browser-profile-mutations.d.ts
type RegisterRemoteCdpBrowserProfileResult = {
  ok: true;
  name: string;
} | {
  ok: false;
  error: string;
};
/**
 * Register a remote-CDP browser profile (attach-only, no local launch) under
 * `name`, replacing any existing profile with that name.
 *
 * Registration is create-only, but a re-attach after the prior session
 * expired reuses the same profile name. `replaceExisting` overwrites in the
 * same config mutation instead of deleting first: a failed replacement
 * (invalid endpoint, exhausted ports) then leaves the old working profile in
 * place rather than deleting it and returning an error with nothing left, and
 * `browser.defaultProfile` is never touched either way.
 */
declare function registerRemoteCdpBrowserProfile(params: {
  name: string;
  cdpUrl: string;
}): Promise<RegisterRemoteCdpBrowserProfileResult>;
/** Remove a previously registered browser profile by name. */
declare function unregisterRemoteCdpBrowserProfile(name: string): Promise<void>;
//#endregion
export { RegisterRemoteCdpBrowserProfileResult, registerRemoteCdpBrowserProfile, unregisterRemoteCdpBrowserProfile };