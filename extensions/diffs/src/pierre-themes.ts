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

// `@pierre/diffs` pre-registers these names, so `registerCustomTheme` cannot replace its loaders.
// Seed the resolved-theme cache before preload so SSR uses the Node-safe JSON themes.
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
