// Diffs plugin module implements pierre themes behavior.
import { createRequire } from "node:module";
import type { ThemeRegistrationResolved } from "@pierre/diffs";
import { registerCustomTheme } from "@pierre/diffs";
import { readJsonFileWithFallback } from "openclaw/plugin-sdk/json-store";

type PierreThemeName = "pierre-dark" | "pierre-light";
const themeRequire = createRequire(import.meta.url);
const PIERRE_THEME_SPECS = [
  ["pierre-dark", "@pierre/theme/themes/pierre-dark.json"],
  ["pierre-light", "@pierre/theme/themes/pierre-light.json"],
] as const satisfies ReadonlyArray<readonly [PierreThemeName, string]>;

function createThemeLoader(
  themeName: PierreThemeName,
  themeSpecifier: string,
): () => Promise<ThemeRegistrationResolved> {
  let cachedTheme: ThemeRegistrationResolved | undefined;
  return async () => {
    if (cachedTheme) {
      return cachedTheme;
    }
    const themePath = themeRequire.resolve(themeSpecifier);
    const { value: theme } = await readJsonFileWithFallback<Record<string, unknown>>(themePath, {});
    cachedTheme = {
      ...theme,
      name: themeName,
    } as ThemeRegistrationResolved;
    return cachedTheme;
  };
}

// `registerCustomTheme` rejects (and logs) a second registration for the same
// name, so register our Node-safe loaders exactly once per process rather
// than on every render call.
let pierreThemesRegistered = false;

export function ensurePierreThemesRegistered(): void {
  if (pierreThemesRegistered) {
    return;
  }
  pierreThemesRegistered = true;

  for (const [themeName, themeSpecifier] of PIERRE_THEME_SPECS) {
    registerCustomTheme(themeName, createThemeLoader(themeName, themeSpecifier));
  }
}
