import type { LibrarySnapshot, Node, TabItem } from "../../data/model";
import { childrenOf } from "./tree";

export interface ExportItem {
  url: string;
  title: string;
  notes?: string;
  rating?: number;
  createdAt: number;
}

export interface ExportGroup {
  label: string;
  path: string[];
  items: ExportItem[];
}

export interface ExportDocument {
  format: "tabnest-export";
  version: 1;
  exportedAt: number;
  groups: ExportGroup[];
}

function toItem(tab: TabItem): ExportItem {
  return {
    url: tab.url,
    title: tab.title,
    createdAt: tab.createdAt,
    ...(tab.notes === undefined ? {} : { notes: tab.notes }),
    ...(tab.rating === undefined ? {} : { rating: tab.rating }),
  };
}

/** Flattens the tree into one entry per group, in document order. */
export function collectGroups(snapshot: LibrarySnapshot): ExportGroup[] {
  const map = new Map(snapshot.nodes.map((node) => [node.id, node]));
  const groups: ExportGroup[] = [];

  const visit = (id: string, path: string[]): void => {
    const children = childrenOf(map, id);
    const items = children.filter((node): node is TabItem => node.kind === "tab").map(toItem);
    if (items.length > 0) groups.push({ label: path.at(-1) ?? "All lists", path, items });

    for (const child of children) {
      if (child.kind !== "group") continue;
      if (child.groupType === "trash") continue;
      const label = child.label ?? (child.groupType === "window" ? "Window" : "Folder");
      visit(child.id, [...path, label]);
    }
  };

  visit("root", ["All lists"]);
  return groups;
}

export function toExportDocument(snapshot: LibrarySnapshot): ExportDocument {
  return {
    format: "tabnest-export",
    version: 1,
    exportedAt: Date.now(),
    groups: collectGroups(snapshot),
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** A self-contained, shareable page. No script, so it is inert by construction. */
export function toHtml(snapshot: LibrarySnapshot): string {
  const groups = collectGroups(snapshot);
  const total = groups.reduce((sum, group) => sum + group.items.length, 0);
  const exported = new Date().toISOString().slice(0, 10);

  const body = groups
    .map((group) => {
      const items = group.items
        .map((item) => {
          const note = item.notes ? `<p class="note">${escapeHtml(item.notes)}</p>` : "";
          return `<li><a href="${escapeHtml(item.url)}" rel="noreferrer">${escapeHtml(
            item.title || item.url,
          )}</a>${note}</li>`;
        })
        .join("\n");
      const trail = group.path.slice(0, -1).join(" / ");
      return `<section>
  <h2>${escapeHtml(group.label)}</h2>
  ${trail ? `<p class="trail">${escapeHtml(trail)}</p>` : ""}
  <ul>
${items}
  </ul>
</section>`;
    })
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>TabNest library — ${exported}</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 15px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
         max-width: 780px; margin: 40px auto; padding: 0 20px; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  h2 { font-size: 16px; margin: 28px 0 2px; }
  .trail { margin: 0; color: #6b7280; font-size: 12px; }
  ul { margin: 6px 0 0; padding-inline-start: 20px; }
  li { margin: 2px 0; }
  a { color: #4f46e5; text-decoration: none; }
  a:hover { text-decoration: underline; }
  .note { margin: 2px 0 6px; color: #6b7280; font-size: 13px; }
  .meta { color: #6b7280; font-size: 12px; }
</style>
</head>
<body>
<h1>TabNest library</h1>
<p class="meta">${total} tabs · exported ${exported}</p>
${body}
</body>
</html>
`;
}

export function downloadFile(name: string, content: string, type: string): void {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export function countItems(groups: readonly ExportGroup[]): number {
  return groups.reduce((sum, group) => sum + group.items.length, 0);
}

export type { Node };
