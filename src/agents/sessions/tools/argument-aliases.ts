/**
 * Shared prepareArguments helper for renaming a legacy model-emitted alias
 * key to its canonical schema key.
 */

/**
 * Renames `aliasKey` to `canonicalKey` when the canonical key is absent and
 * the alias value is a string, dropping the alias key so a schema with
 * additionalProperties: false doesn't see it as unexpected. Returns a new
 * object when it changes anything, and the same `args` reference otherwise
 * — never mutates `args`, which may be a model's persisted tool-call input.
 */
export function renameStringKeyAlias(
  args: Record<string, unknown>,
  canonicalKey: string,
  aliasKey: string,
): Record<string, unknown> {
  if (typeof args[aliasKey] !== "string") {
    return args;
  }
  const { [aliasKey]: aliasValue, ...rest } = args;
  return rest[canonicalKey] === undefined ? { ...rest, [canonicalKey]: aliasValue } : rest;
}
