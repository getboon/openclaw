---
summary: "Ask the agent to redo the step that didn't finish"
read_when:
  - Using /retry after a "step didn't finish" note
title: "Retry"
sidebarTitle: "Retry"
---

`/retry` asks the agent to redo the step named in its own last reply. It appears
as a button on the step-failure note ("One step didn't finish" / "N steps
didn't finish"), and can also be typed directly.

## Usage

```text
/retry
```

Behavior:

- Takes no arguments.
- Always starts a new turn with a fixed nudge — it never tries to steer an
  already-active run, unlike `/steer`.
- The agent decides how to redo the step using the conversation context it
  already has, including its own prior "step didn't finish" note.
- If the step fails again, the same note and Retry button appear again.
- The button works on Discord, Microsoft Teams, Slack, and Telegram; typing
  `/retry` directly works everywhere.

## Related

- [Slash commands](/tools/slash-commands)
- [Steer](/tools/steer)
