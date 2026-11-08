/**
 * The record kinds. Two shapes share one store and one id space:
 *
 *   TabItem  a parked page
 *   Group    a container: folder, window, tab group, quick list, root, trash
 *
 * Invariants the repository maintains:
 *   1. for every id in group.children, node.parents includes group.id
 *   2. for every group id in node.parents, that group's children includes node.id
 *   3. children order is meaningful and unique within a group
 *   4. every node is reachable from root, except quickList/trash members
 */

export type Id = string;

export type GroupType = "root" | "quickList" | "trash" | "folder" | "window" | "tabGroup";

export const ROOT_ID = "root";
export const QUICK_LIST_ID = "quickList";
export const TRASH_ID = "trash";

/** Every node reachable without being a member of anything. */
export const SYSTEM_GROUP_IDS: readonly Id[] = [ROOT_ID, QUICK_LIST_ID, TRASH_ID];

export interface BaseNode {
  id: Id;
  createdAt: number;
  updatedAt: number;
  /** Groups this node belongs to. May be empty for orphaned records. */
  parents: Id[];
  /** Set while the record sits in the trash, so restoring puts it back. */
  trashedFrom?: Id;
}

export interface TabItem extends BaseNode {
  kind: "tab";
  url: string;
  title: string;
  /** Lowercased hostname, denormalised for grouping and search. */
  host: string;
  notes?: string;
  rating?: 0 | 1 | 2 | 3 | 4 | 5;
  /** Set when moved to the archive; records stay readable. */
  archivedAt?: number;
}

export interface Group extends BaseNode {
  kind: "group";
  groupType: GroupType;
  label?: string;
  /** Optional accent, used by window and tab-group records. */
  color?: string;
  /** How many leading children are pinned, for restore semantics. */
  pinnedCount?: number;
  children: Id[];
}

export type Node = TabItem | Group;

export function isTab(node: Node): node is TabItem {
  return node.kind === "tab";
}

export function isGroup(node: Node): node is Group {
  return node.kind === "group";
}

export function isSystemGroup(node: Node): boolean {
  return isGroup(node) && SYSTEM_GROUP_IDS.includes(node.id);
}

/** A group that holds user content and can be renamed, moved and deleted. */
export function isUserGroup(node: Node): boolean {
  return (
    isGroup(node) &&
    (node.groupType === "folder" || node.groupType === "window") &&
    !isSystemGroup(node)
  );
}

export interface Tombstone {
  id: Id;
  deletedAt: number;
  /** Kept so a long-offline device cannot resurrect the record. */
  reason: "deleted" | "purged";
}

/** One local mutation, mirrored to the sync backends when enabled. */
export interface ChangeRecord {
  seq?: number;
  at: number;
  op: ChangeOp;
}

export type ChangeOp =
  | { op: "upsert"; node: Node }
  | { op: "delete"; id: Id; at: number }
  | { op: "reorder"; id: Id; children: Id[]; at: number }
  | { op: "settings"; patch: Record<string, unknown>; at: number };

export interface Settings {
  /** What to do with pinned tabs when parking a window. */
  pinned: "ignore" | "park" | "stop";
  /** Hosts never captured. `*.example.com` matches subdomains. */
  excludedDomains: string[];
  /** What to do when a URL is already in the library. */
  alreadyParked: "skip" | "duplicate";
  /** Map Chrome tab groups to nested groups, or flatten them. */
  tabGroups: "respect" | "flatten";
  /** Which tabs to close once records are committed. */
  closeAfter: "window" | "tabGroup" | "never";
  /** Where restored tabs open. */
  openIn: "current" | "tab" | "window";
  /** Theme preference for the pages. */
  theme: "auto" | "light" | "dark";
}

export const DEFAULT_SETTINGS: Settings = {
  pinned: "ignore",
  excludedDomains: [],
  alreadyParked: "skip",
  tabGroups: "respect",
  closeAfter: "window",
  openIn: "tab",
  theme: "auto",
};

/** Snapshot handed to the pages: the whole library is small enough to ship once. */
export interface LibrarySnapshot {
  nodes: Node[];
  settings: Settings;
  stats: LibraryStats;
}

export interface LibraryStats {
  tabs: number;
  groups: number;
  folders: number;
  total: number;
  quarantined: number;
}
