// Diffs plugin module implements pierre themes behavior.
import { createRequire } from "node:module";
import type { ThemeRegistrationResolved } from "@pierre/diffs";
import { attachResolvedThemes, getSharedHighlighter } from "@pierre/diffs";
import { readJsonFileWithFallback } from "openclaw/plugin-sdk/json-store";

type PierreThemeName = "pierre-dark" | "pierre-light";
const themeRequire = createRequire(import.meta.url);
const PIERRE_THEME_SPECS = [
  ["pierre-dark", "@pierre/theme/themes/pierre-dark.json"],
  ["pierre-light", "@pierre/theme/themes/pierre-light.json"],
] as const satisfies ReadonlyArray<readonly [PierreThemeName, string]>;

async function loadPierreTheme(
  themeName: PierreThemeName,
  themeSpecifier: string,
): Promise<ThemeRegistrationResolved> {
  const themePath = themeRequire.resolve(themeSpecifier);
  const { value: theme } = await readJsonFileWithFallback<Record<string, unknown>>(themePath, {});
  return {
    ...theme,
    name: themeName,
  } as ThemeRegistrationResolved;
}

// `@pierre/diffs` registers its own bundled loaders for "pierre-dark"/"pierre-light"
// as an import-time side effect (shared_highlighter.js), before any application code
// runs, so `registerCustomTheme` always rejects a Node-safe loader for these exact
// names as a duplicate. Seeding the resolved-theme cache directly (rather than
// registering a loader) is the one path that still wins: `attachResolvedThemes` only
// seeds a theme that nothing has resolved yet, so this must happen before the first
// real preload/resolve call for these themes -- callers await this before rendering.
let pierreThemesRegistered: Promise<void> | undefined;

export function ensurePierreThemesRegistered(): Promise<void> {
  pierreThemesRegistered ??= (async () => {
    const highlighter = await getSharedHighlighter({ themes: [], langs: [] });
    const themes = await Promise.all(
      PIERRE_THEME_SPECS.map(([themeName, themeSpecifier]) =>
        loadPierreTheme(themeName, themeSpecifier),
      ),
    );
    attachResolvedThemes(themes, highlighter);
  })();
  return pierreThemesRegistered;
}
