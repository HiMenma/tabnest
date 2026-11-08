import {
  type Id,
  type LibrarySnapshot,
  type Node,
  SYSTEM_GROUP_IDS,
  type TabItem,
} from "../../data/model";

/** A view id, not a record: the sidebar's Archive entry. */
export const ARCHIVE_VIEW = "archive";

/** Groups whose name the user may edit: containers they created, not system ones. */
export function isRenamable(node: Node | undefined): boolean {
  if (node?.kind !== "group") return false;
  if (SYSTEM_GROUP_IDS.includes(node.id)) return false;
  return (
    node.groupType === "folder" || node.groupType === "window" || node.groupType === "tabGroup"
  );
}

/** Ordered children of a group, skipping ids that no longer exist. */
export function childrenOf(map: Map<Id, Node>, id: Id): Node[] {
  const group = map.get(id);
  if (group?.kind !== "group") return [];
  const out: Node[] = [];
  for (const childId of group.children) {
    const child = map.get(childId);
    if (child) out.push(child);
  }
  return out;
}

/** Root -> ... -> node, excluding the node itself. */
export function ancestorsOf(map: Map<Id, Node>, id: Id): Node[] {
  const chain: Node[] = [];
  const seen = new Set<Id>();
  let current = map.get(id);
  while (current) {
    const parentId = current.parents[0];
    if (parentId === undefined || seen.has(parentId)) break;
    seen.add(parentId);
    const parent = map.get(parentId);
    if (!parent) break;
    chain.unshift(parent);
    current = parent;
  }
  return chain;
}

export function subtreeTabs(map: Map<Id, Node>, id: Id): TabItem[] {
  const out: TabItem[] = [];
  const visit = (nodeId: Id, depth: number): void => {
    if (depth > 32) return;
    const node = map.get(nodeId);
    if (!node) return;
    if (node.kind === "tab") {
      out.push(node);
      return;
    }
    for (const childId of node.children) visit(childId, depth + 1);
  };
  visit(id, 0);
  return out;
}

export function countTabs(map: Map<Id, Node>, id: Id): number {
  return subtreeTabs(map, id).length;
}

/** Direct tab children only — what the list shows for a group. */
export function directTabs(map: Map<Id, Node>, id: Id): TabItem[] {
  return childrenOf(map, id).filter((node): node is TabItem => node.kind === "tab");
}

export interface SearchHit {
  node: TabItem;
  /** Human readable location, e.g. "Reading / Docs". */
  trail: string;
}

function trailOf(map: Map<Id, Node>, id: Id): string {
  return ancestorsOf(map, id)
    .filter((node) => node.kind === "group" && node.label)
    .map((node) => (node.kind === "group" ? (node.label ?? "") : ""))
    .filter(Boolean)
    .join(" / ");
}

/**
 * Case-insensitive AND matching over title, URL, host and notes. Scans linearly:
 * a 5k-item library is ~1ms per keystroke, and the simplicity is worth more than
 * an index nobody needs to maintain.
 */
export function searchTabs(map: Map<Id, Node>, query: string, limit = 500): SearchHit[] {
  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .filter((term) => term.length > 0);
  if (terms.length === 0) return [];

  const hits: SearchHit[] = [];
  for (const node of map.values()) {
    if (node.kind !== "tab") continue;
    const haystack = `${node.title} ${node.url} ${node.host} ${node.notes ?? ""}`.toLowerCase();
    if (!terms.every((term) => haystack.includes(term))) continue;
    hits.push({ node, trail: trailOf(map, node.id) });
    if (hits.length >= limit) break;
  }
  hits.sort((a, b) => (b.node.updatedAt ?? 0) - (a.node.updatedAt ?? 0));
  return hits;
}

export function buildMap(snapshot: LibrarySnapshot | null): Map<Id, Node> {
  return new Map((snapshot?.nodes ?? []).map((node) => [node.id, node]));
}

/** Groups that can receive a drop or be navigated to. */
export function isContainer(node: Node | undefined): boolean {
  return node?.kind === "group" && node.groupType !== "trash";
}

export function formatDate(timestamp: number): string {
  if (!timestamp) return "";
  const date = new Date(timestamp);
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  if (sameDay) {
    return date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  }
  const sameYear = date.getFullYear() === now.getFullYear();
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}
