---
summary: "Prepare inbound PDFs in the background with pdf-index and tell the agent what is ready"
title: "PDF preparation"
sidebarTitle: "PDF preparation"
read_when:
  - You want inbound PDFs prepared for text search before the agent reads them
  - You need to enable, disable, or debug the bundled boon-pdf-prep plugin
---

The bundled `boon-pdf-prep` plugin starts text preparation for each inbound PDF as soon as the message arrives. It also tells the agent which PDFs are ready for search on each turn. The plugin does no PDF work itself. It calls the `pdf-index` CLI, which must be on the Gateway `PATH`.

## What it does

- **Message arrives:** for each attached PDF, the plugin runs `pdf-index enqueue <paths...>`. It does not wait for the command.
- **Before the model call:** the plugin reads the `[media attached: ...]` lines of the turn prompt and runs `pdf-index status <refs...>` with a 1.5 second limit. For a file that `status` does not know, it runs `pdf-index enqueue` again without waiting.
- **Status note:** the plugin adds a short note to the model input only. The note does not go into the session transcript. Example:

  ```text
  [PDF preparation]
  - "plans.pdf" (sha256 <64 hex chars>): 1546 pages. Text search covers pages 1-400. The rest in about 57 s.
  Use: pdf-index search <sha256> --q="<keywords>". The result states its coverage.
  ```

- A ready PDF gets a line only the first time the Gateway process sees its hash. A PDF that is not ready gets a line on every turn.
- The suggested command uses the file hash, so file names never reach a command line. File names are cleaned before they go into the note.

The plugin starts every command with an argument list, never through a shell.

## Enable

The plugin is bundled and enabled by default. A host with a `plugins.allow` list loads it only when the list holds `boon-pdf-prep`:

```json5
{
  plugins: {
    allow: ["boon-pdf-prep"],
  },
}
```

The plugin has no config.

## Failure behavior

The plugin never blocks or fails a turn.

- If `pdf-index` is missing, an `enqueue` error is dropped.
- If `status` times out, exits non-zero, does not know the command, or prints bad JSON, the turn continues with no note.

## Disable

Remove `boon-pdf-prep` from `plugins.allow`, or set `plugins.entries["boon-pdf-prep"].enabled = false`.
