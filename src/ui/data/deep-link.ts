/** `library.html?group=<id>` — used by the menu's recent-lists submenu. */
export function parseGroupParam(search: string): string | null {
  const value = new URLSearchParams(search).get("group");
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
