// Browser Login Handoff plugin entrypoint registers the browser_handoff tool.
import type {
  AnyAgentTool,
  OpenClawPluginApi,
  OpenClawPluginToolFactory,
} from "openclaw/plugin-sdk/plugin-entry";
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { BrowserHandoffToolSchema } from "./src/schema.js";

function readAction(raw: Record<string, unknown>): "request_login" | "status" | "attach" {
  const action = raw.action;
  if (action === "request_login" || action === "status" || action === "attach") {
    return action;
  }
  throw new Error('browser_handoff: action must be one of "request_login", "status", "attach"');
}

function readSite(raw: Record<string, unknown>): string {
  const site = typeof raw.site === "string" ? raw.site.trim() : "";
  if (!site) {
    throw new Error("browser_handoff: site is required");
  }
  return site;
}

function readOptionalString(raw: Record<string, unknown>, key: string): string | undefined {
  const value = raw[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function createBrowserHandoffTool(api: OpenClawPluginApi): AnyAgentTool {
  return {
    label: "Browser Login Handoff",
    name: "browser_handoff",
    description: [
      "Hand off login, CAPTCHA, or 2FA on a login-walled site to the customer instead of dead-ending.",
      "The customer signs in themselves via a hosted browser session link; never enter credentials here.",
      "action=request_login: mint a sign-in link for `site` and share it with the customer.",
      "action=status: check whether the customer finished signing in.",
      "action=attach: once status is ready, register the resulting session as a reusable browser profile.",
      "After attach, use the browser tool with profile=<name> from the attach reply to continue on that site.",
    ].join(" "),
    parameters: BrowserHandoffToolSchema,
    execute: async (_toolCallId, args) => {
      const raw = args && typeof args === "object" ? (args as Record<string, unknown>) : {};
      const { executeBrowserHandoffTool } = await import("./src/tool.js");
      return await executeBrowserHandoffTool(api, {
        action: readAction(raw),
        site: readSite(raw),
        ...(readOptionalString(raw, "loginUrl")
          ? { loginUrl: readOptionalString(raw, "loginUrl") }
          : {}),
        ...(readOptionalString(raw, "reason") ? { reason: readOptionalString(raw, "reason") } : {}),
      });
    },
  };
}

export default definePluginEntry({
  id: "browser-handoff",
  name: "Browser Login Handoff",
  description:
    "Hand off login/CAPTCHA/2FA on a login-walled site to the customer via a hosted browser session.",
  register(api: OpenClawPluginApi) {
    api.registerTool(((_ctx) => createBrowserHandoffTool(api)) as OpenClawPluginToolFactory);
  },
});
