---
summary: "Analyze one or more PDF documents with native provider support and extraction fallback"
title: "PDF tool"
read_when:
  - You want to analyze PDFs from agents
  - You need exact pdf tool parameters and limits
  - You are debugging native PDF mode vs extraction fallback
---

`pdf` analyzes one or more PDF documents and returns text. It uses native document input on Anthropic and Google models, and falls back to text/image extraction for every other provider.

## Availability

The tool registers only when OpenClaw can resolve a PDF-capable model for the agent. Resolution order:

1. `agents.defaults.pdfModel` (explicit primary/fallbacks)
2. `agents.defaults.imageModel` (explicit primary/fallbacks)
3. The agent's resolved session/default model, if its provider supports native PDF input (Anthropic, Google) or already has a configured vision model
4. Auto-detected image/vision-capable providers with usable auth, preferring native-PDF providers first

Every fallback candidate is auth-checked before use, so a configured `provider/model` only counts if OpenClaw can authenticate that provider for the agent. If no usable model resolves, the `pdf` tool is not exposed.

## Input reference

<ParamField path="pdf" type="string">
One PDF path or URL.
</ParamField>

<ParamField path="pdfs" type="string[]">
Multiple PDF paths or URLs, up to 10 total.
</ParamField>

<ParamField path="prompt" type="string" default="Analyze this PDF document.">
Analysis prompt.
</ParamField>

<ParamField path="pages" type="string">
Page filter like `1-5` or `1,3,7-9`. Not supported in native provider mode.
</ParamField>

<ParamField path="password" type="string">
Password for encrypted PDFs. Applies to every PDF in the request; only used by extraction fallback mode.
</ParamField>

<ParamField path="model" type="string">
Optional model override in `provider/model` form.
</ParamField>

<ParamField path="maxBytesMb" type="number">
Per-PDF size cap in MB. Defaults to `agents.defaults.pdfMaxBytesMb` or `10`, and
is clamped to `768` however it is set. PDFium runs in a 2GiB WASM heap and copies
the whole file into it, so the file and its per-page working set share those 2GiB;
a larger cap would accept files the engine then aborts on. A configured `1024`
therefore behaves as `768`, and oversized files are refused naming the 768MB limit.
</ParamField>

Notes:

- `pdf` and `pdfs` are merged and deduplicated before loading; at least one is required.
- `pages` is parsed as 1-based page numbers, deduped, sorted, and clamped to `agents.defaults.pdfMaxPages` (default `20`). A range that matches no in-bounds pages errors before the model call.

## Supported PDF references

- Local file path (including `~` expansion)
- `file://` URL
- `http://` and `https://` URL
- OpenClaw-managed inbound refs such as `media://inbound/<id>`

Other URI schemes (for example `ftp://`) return `details.error = "unsupported_pdf_reference"`. Remote `http(s)` URLs are rejected when the tool runs sandboxed. With workspace-only file policy enabled, local paths outside allowed roots are rejected; managed inbound refs and replayed paths under OpenClaw's inbound media store are still allowed.

## Execution modes

### Native provider mode

Used for provider `anthropic` and `google` (the only providers that currently declare native PDF document support). Raw PDF bytes go directly to the provider API as a native document/inline-PDF part per file.

Limits:

- The base64-encoded request must fit the provider's request cap: 32MB for
  `anthropic`, 20MB for `google`. All PDFs in one call share a single request, so
  the budget is their combined encoded size (about 3/4 of the cap in raw bytes).
  Over it, the tool silently uses extraction fallback mode instead, which is
  bounded by `maxPages` rather than by file size.
- `pages` is not supported. If set, the tool returns an error.
- `password` is not supported. Use a non-native model to analyze encrypted PDFs.
  Note both errors above are only reachable while the request fits the size cap;
  a larger PDF takes the extraction path, where `pages` and `password` do work.
- Multi-PDF input is supported; each PDF is sent as a native document block /
  inline PDF part before the prompt.

### Extraction fallback mode

Used for every other provider.

1. Select pages up to `agents.defaults.pdfMaxPages` (default `20`).
2. Extract them in bounded 10-page batches, preserving the document page count,
   processed page numbers, text limits, and truncation reasons.
3. If extracted text length is below `200` chars, render the batch to PNG images and include them.
4. Analyze each batch independently and synthesize the batch findings into one answer.

Fallback details:

- Every fallback result starts with user-visible coverage such as
  `PDF coverage: processed pages 1-59 of 59`.
- If the page ceiling or an extraction limit leaves gaps, the result starts with
  a partial-read warning, `details.status` is `partial`, and the model is
  instructed not to make document-wide absence claims.
- Page image extraction uses a pixel budget of `4,000,000`.
- Encrypted PDFs can be opened with the top-level `password` parameter.
- If the target model does not support image input and there is no extractable text, the tool errors.
- If text extraction succeeds but image extraction would require vision on a
  text-only model, OpenClaw drops the rendered images and continues with the
  extracted text.
- Extraction fallback uses the bundled `document-extract` plugin. The plugin owns
  `clawpdf`, which provides text extraction and image rendering through PDFium
  WebAssembly.

## Config

```json5
{
  agents: {
    defaults: {
      pdfModel: {
        primary: "anthropic/claude-opus-4-6",
        fallbacks: ["openai/gpt-5.4-mini"],
      },
      pdfMaxBytesMb: 10,
      pdfMaxPages: 20,
    },
  },
}
```

| Key                             | Default | Meaning                                                                                   |
| ------------------------------- | ------- | ----------------------------------------------------------------------------------------- |
| `agents.defaults.pdfModel`      | unset   | Explicit primary/fallback PDF models; falls back to `imageModel`, then the session model. |
| `agents.defaults.pdfMaxBytesMb` | `10`    | Per-PDF size cap in MB.                                                                   |
| `agents.defaults.pdfMaxPages`   | `20`    | Max pages processed per PDF.                                                              |

See [Configuration Reference](/gateway/config-agents#agent-defaults) for full field details.

## Output details

The tool returns text in `content[0].text` and structured metadata in `details`.

Common `details` fields:

- `model`: resolved model ref (`provider/model`)
- `native`: `true` for native provider mode, `false` for fallback
- `attempts`: fallback attempts that failed before success
- `status`: `ok` or `partial` when extraction coverage is available
- `coverage[]`: per-document page count, requested/processed pages, text
  character and byte counts, completion flag, and truncation reasons

Path fields:

- Single PDF input: `details.pdf`
- Multiple PDF inputs: `details.pdfs[]` with `pdf` entries
- Sandbox path rewrite metadata (when applicable): `rewrittenFrom`

## Error behavior

| Condition                         | Result                                                         |
| --------------------------------- | -------------------------------------------------------------- |
| No PDF input                      | Throws `pdf required: provide a path or URL to a PDF document` |
| More than 10 PDFs                 | `details.error = "too_many_pdfs"`                              |
| Unsupported reference scheme      | `details.error = "unsupported_pdf_reference"`                  |
| `pages` with a native provider    | Throws `pages is not supported with native PDF providers`      |
| `password` with a native provider | Throws `password is not supported with native PDF providers`   |

## Examples

Single PDF:

```json
{
  "pdf": "/tmp/report.pdf",
  "prompt": "Summarize this report in 5 bullets"
}
```

Multiple PDFs:

```json
{
  "pdfs": ["/tmp/q1.pdf", "/tmp/q2.pdf"],
  "prompt": "Compare risks and timeline changes across both documents"
}
```

Page-filtered fallback model:

```json
{
  "pdf": "https://example.com/report.pdf",
  "pages": "1-3,7",
  "model": "openai/gpt-5.4-mini",
  "prompt": "Extract only customer-impacting incidents"
}
```

Encrypted PDF with extraction fallback:

```json
{
  "pdf": "/tmp/locked.pdf",
  "password": "example-password",
  "model": "openai/gpt-5.4-mini",
  "prompt": "Summarize this contract"
}
```

## Related

- [Tools Overview](/tools) - all available agent tools
- [Configuration Reference](/gateway/config-agents#agent-defaults) - pdfMaxBytesMb and pdfMaxPages config
