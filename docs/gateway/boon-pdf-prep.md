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
- A ready PDF gets a `Ready.` line once per session. The session is the run `sessionId`, else its `sessionKey`. A new session for the same thread, for example after `/new`, gets the line again. A run with neither gets the line on every turn. A PDF shown as queued or in progress earlier gets one `Ready.` line when it becomes ready.
- When `pdf-index status` reports earlier findings for a PDF, its line ends with `Earlier findings: <count> on pages <pages>. Run pdf-index recall <sha256> before you read these pages.` The plugin keeps only digits, commas and hyphens in the pages value, at most 80 characters. If the pages value is missing or empty after cleaning, the line has no `on pages <pages>` part. Older `pdf-index` versions report no findings, and the line has no findings part.
- When `pdf-index status` reports findings for a listed PDF, even a count of 0, the note also ends with one line that asks the agent to save its results with `pdf-index note`.
- When a listed PDF that has not failed has more than 20 pages, the note also has one line after the search line. It tells the agent to split a whole-file read, summary or review into 10-20 page ranges with one sub-agent each, and that attached file text is not a read of the file.
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
