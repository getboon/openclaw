// Browser Login Handoff plugin entrypoint registers the browser_handoff tool.
import type {
  AnyAgentTool,
  OpenClawPluginApi,
  OpenClawPluginToolFactory,
} from "openclaw/plugin-sdk/plugin-entry";
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { BrowserHandoffToolSchema } from "./src/schema.js";

function createBrowserHandoffTool(
  api: OpenClawPluginApi,
  sessionKey: string | undefined,
): AnyAgentTool {
  return {
    label: "Browser Login Handoff",
    name: "browser_handoff",
    description: [
      "Hand off login, CAPTCHA, or 2FA on a login-walled site to the customer instead of dead-ending.",
      "The customer signs in themselves via a hosted browser session link; never enter credentials here.",
      "action=request_login: mint a sign-in link for `site` and share it with the customer. You'll be",
      "resumed automatically once they finish — you don't need to wait or re-check yourself.",
      "action=status: check whether the customer finished signing in.",
      "action=attach: once status is ready, register the resulting session as a reusable browser profile.",
      "After attach, use the browser tool with profile=<name> from the attach reply to continue on that site.",
    ].join(" "),
    parameters: BrowserHandoffToolSchema,
    execute: async (_toolCallId, args) => {
      const { executeBrowserHandoffToolFromArgs } = await import("./src/tool.js");
      return await executeBrowserHandoffToolFromArgs(api, args, { sessionKey });
    },
  };
}

export default definePluginEntry({
  id: "browser-handoff",
  name: "Browser Login Handoff",
  description:
    "Hand off login/CAPTCHA/2FA on a login-walled site to the customer via a hosted browser session.",
  register(api: OpenClawPluginApi) {
    api.registerTool(((ctx) =>
      createBrowserHandoffTool(api, ctx.sessionKey)) as OpenClawPluginToolFactory);
  },
});
