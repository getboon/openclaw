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

- **Message arrives:** for each attached PDF in the message metadata, the plugin runs `pdf-index enqueue <paths...>` with the inbound file paths. It does not wait for the command.
- **Before the model call:** the plugin reads the `[media attached: ...]` lines of the turn prompt. It keeps only managed inbound refs (`media://inbound/<id>`). It runs `pdf-index status <refs...>` with a 1.5 second limit. For a file that `status` does not know, it runs `pdf-index enqueue <refs...>` again without waiting.
- **Status note:** the plugin adds a short note to the model input only. The note does not go into the session transcript. Example:

  ```text
  [PDF preparation]
  - "plans.pdf" (sha256 <64 hex chars>): 1546 pages. Text search covers pages 1-400. The rest in about 57 s.
  Use: pdf-index search <sha256> --q="<keywords>". The result states its coverage.
  ```

- A PDF that is not ready gets a line on every turn once its hash is known. A new PDF can get no line until `pdf-index` has hashed it.
- A ready PDF gets a `Ready.` line once per Gateway process. A PDF shown as queued or in progress earlier gets one `Ready.` line when it becomes ready.
- The suggested `pdf-index search` command uses the file hash. Only `enqueue` and `status` receive file refs: inbound paths or `media://inbound/<id>` refs. File names never reach a command line, and they are cleaned before they go into the note.

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

The plugin never fails a turn. The status check can delay the model call by at most 1.5 seconds.

- If `pdf-index` is missing, an `enqueue` error is dropped.
- If `status` times out, exits non-zero, does not know the command, or prints bad JSON, the turn continues with no note.

## Disable

Remove `boon-pdf-prep` from `plugins.allow`, or set `plugins.entries["boon-pdf-prep"].enabled = false`.
