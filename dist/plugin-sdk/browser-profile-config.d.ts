//#region src/plugin-sdk/browser-profile-config.d.ts
type RegisterRemoteCdpBrowserProfileResult = {
  ok: true;
  name: string;
} | {
  ok: false;
  error: string;
};
/** Register a remote-CDP browser profile when the browser plugin is active. */
declare function registerRemoteCdpBrowserProfile(params: {
  name: string;
  cdpUrl: string;
}): Promise<RegisterRemoteCdpBrowserProfileResult>;
/** Remove a previously registered browser profile when the browser plugin is active. */
declare function unregisterRemoteCdpBrowserProfile(name: string): Promise<void>;
//#endregion
export { RegisterRemoteCdpBrowserProfileResult, registerRemoteCdpBrowserProfile, unregisterRemoteCdpBrowserProfile };