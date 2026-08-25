---
name: browser-login-handoff
description: Use when a browser task hits a login wall, CAPTCHA, or 2FA and the browser_handoff tool is available, to hand sign-in off to the customer instead of dead-ending or entering their credentials.
user-invocable: false
---

# Browser Login Handoff

Use this skill together with the `browser` tool whenever a site requires login,
CAPTCHA, or 2FA that you cannot and must not complete yourself.

## Hard rule

Never type, guess, or otherwise enter the customer's username, password, CAPTCHA
answer, or 2FA code. The customer is always the one who signs in. Your job is to
mint the sign-in link, hand it off, wait, then reuse the resulting session.

## Flow

1. `browser_handoff` with `action="request_login"`, `site="<hostname>"` (e.g.
   `"app.procore.com"`), and optionally `loginUrl`/`reason` (e.g. `"captcha"`,
   `"2fa"`, `"session_expired"`).
2. Share the returned link with the customer in the current conversation and ask
   them to sign in there, including any CAPTCHA/2FA challenge. Do not proceed on
   the site yourself while this is pending.
3. You'll be resumed automatically once the customer finishes — you can end your
   turn now instead of waiting. When you're resumed, call `browser_handoff` with
   `action="status"` and the same `site`; if it still reports pending, just end
   your turn again (you'll be resumed again automatically). Only fall back to
   manually re-checking yourself if the customer explicitly tells you they're
   done and you haven't been resumed yet.
4. When status reports the customer is done, call `browser_handoff` with
   `action="attach"` and the same `site`. This registers the resulting session as
   a reusable browser profile and returns its name.
5. Continue the original task with the `browser` tool, passing `profile=<name>`
   from the attach reply.

Later runs against the same site can reuse the same profile directly with the
`browser` tool — no new handoff is needed until the site's session expires. If a
previously working profile stops working, treat it the same as a fresh login
wall and start this flow again for that site.
