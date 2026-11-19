// Tool validation facade for callers that import validation from agent-core.
export { validateToolArguments, validateToolCall } from "@openclaw/ai/validation";
// Type-only because published @openclaw/ai does not export this class at
// runtime; erasing the binding prevents consumer module-load failures.
export type { ToolArgumentValidationError } from "@openclaw/ai/validation";
