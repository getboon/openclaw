// Tool validation facade for callers that import validation from agent-core.
export { validateToolArguments, validateToolCall } from "@openclaw/ai/validation";
// Type-only: ToolArgumentValidationError is a boon-side addition to the
// externally-resolved @openclaw/ai package, which boon does not publish, so
// published @openclaw/ai never carries it as a runtime export. A type-only
// export erases to nothing at build time, so callers (agent-loop.ts) can
// still type against it without the bundler needing a real binding to
// resolve from the installed @openclaw/ai at a consumer's node_modules.
export type { ToolArgumentValidationError } from "@openclaw/ai/validation";
