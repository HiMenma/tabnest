import type { Settings } from "../../data/model";

/**
 * Applies the theme preference. "auto" removes the attribute so the
 * prefers-color-scheme default in tokens.css takes over.
 */
export function applyTheme(theme: Settings["theme"] | undefined): void {
  const root = document.documentElement;
  if (theme === "light" || theme === "dark") root.dataset.theme = theme;
  else delete root.dataset.theme;
}
