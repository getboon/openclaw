/**
 * JSON schema for the Browser Login Handoff agent tool.
 *
 * Kept flat (no nested unions) to match the browser tool's schema precedent:
 * some provider function-tool validators reject nested `anyOf` shapes that
 * TypeBox would otherwise emit for a per-action discriminated union.
 */
import { stringEnum } from "openclaw/plugin-sdk/channel-actions";
import { Type } from "typebox";

const BROWSER_HANDOFF_ACTIONS = ["request_login", "status", "attach"] as const;

/** Provider-compatible Browser Login Handoff tool argument schema. */
export const BrowserHandoffToolSchema = Type.Object({
  action: stringEnum(BROWSER_HANDOFF_ACTIONS),
  site: Type.String({
    description:
      'Stable identifier for the target site (e.g. a hostname like "app.procore.com"). Used to key the handoff and the resulting reusable browser profile.',
  }),
  loginUrl: Type.Optional(
    Type.String({
      description:
        "request_login only: the URL the agent was on when it hit the login/CAPTCHA/2FA wall.",
    }),
  ),
  reason: Type.Optional(
    Type.String({
      description:
        'request_login only: why a human is needed, e.g. "login", "captcha", "2fa", "session_expired".',
    }),
  ),
});
