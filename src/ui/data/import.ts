export interface ImportItem {
  url: string;
  title?: string;
}

const URL_PATTERN = /https?:\/\/[^\s<>"')]+/i;

function stripTrailing(url: string): string {
  return url.replace(/[.,;:)\]]+$/, "");
}

/**
 * Accepts the shapes people actually paste: one URL per line, optionally with a
 * title before it separated by a tab or " - ".
 */
export function parseText(input: string): ImportItem[] {
  const items: ImportItem[] = [];
  for (const rawLine of input.split(/\r?\n/)) {
    const line = rawLine.trim().replace(/^[-*•]\s*/, "");
    if (!line) continue;

    const match = URL_PATTERN.exec(line);
    if (!match) continue;

    const url = stripTrailing(match[0]);
    if (!url) continue;

    const before = line
      .slice(0, match.index)
      .trim()
      .replace(/\s*[-–—|]\s*$/, "");
    const after = line.slice(match.index + match[0].length).trim();
    const title = before || after || undefined;
    items.push({ url, ...(title ? { title } : {}) });
  }
  return items;
}

function looksLikeItem(value: unknown): value is { url: string; title?: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { url?: unknown }).url === "string"
  );
}

/**
 * Walks the shapes we have seen in the wild: a flat array, an array of groups
 * with a `tabs`/`items`/`children` array, or this project's own export format.
 */
export function parseJson(input: string): ImportItem[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(input) as unknown;
  } catch {
    return [];
  }

  const items: ImportItem[] = [];
  const push = (entry: { url: string; title?: string }): void => {
    const title = typeof entry.title === "string" ? entry.title : undefined;
    items.push({ url: entry.url, ...(title ? { title } : {}) });
  };

  const walk = (value: unknown, depth: number): void => {
    if (depth > 8 || value === null) return;
    if (Array.isArray(value)) {
      for (const entry of value) walk(entry, depth + 1);
      return;
    }
    if (typeof value !== "object") return;

    const record = value as Record<string, unknown>;
    if (looksLikeItem(record)) {
      push(record as { url: string; title?: string });
      return;
    }
    for (const key of ["items", "tabs", "children", "groups", "entries", "links"]) {
      if (Array.isArray(record[key])) walk(record[key], depth + 1);
    }
  };

  walk(parsed, 0);
  return items;
}

export interface Bookmark {
  url: string;
  title?: string;
}

/** Depth-first flatten of a bookmark tree, skipping folders' own entries. */
export function flattenBookmarks(nodes: readonly chrome.bookmarks.BookmarkTreeNode[]): Bookmark[] {
  const out: Bookmark[] = [];
  const visit = (list: readonly chrome.bookmarks.BookmarkTreeNode[], depth: number): void => {
    if (depth > 16) return;
    for (const node of list) {
      if (node.url) {
        out.push({ url: node.url, ...(node.title ? { title: node.title } : {}) });
      }
      if (node.children) visit(node.children, depth + 1);
    }
  };
  visit(nodes, 0);
  return out;
}

export function dedupe(items: readonly ImportItem[]): ImportItem[] {
  const seen = new Set<string>();
  const out: ImportItem[] = [];
  for (const item of items) {
    if (seen.has(item.url)) continue;
    seen.add(item.url);
    out.push(item);
  }
  return out;
}
