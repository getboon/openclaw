// Tool validation facade for callers that import validation from agent-core.
export { validateToolArguments, validateToolCall } from "@openclaw/ai/validation";

// Published @openclaw/ai never exports ToolArgumentValidationError, as a
// value or as a type -- only the boon-local workspace package does. A
// `export type { ... } from "@openclaw/ai/validation"` re-export would
// resolve fine in this monorepo but fail TS2305 for any consumer
// type-checking against the real registry package, so this is a local
// structural type instead of a re-export.
export interface ToolArgumentValidationErrorShape {
  readonly name: "ToolArgumentValidationError";
  readonly summary: string;
}
