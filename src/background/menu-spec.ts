/**
 * The action menu, described as data.
 *
 * Chrome's context menus are static once installed, so the interesting part —
 * which item is enabled, what the exclusion row says, which groups are recent —
 * is computed here as a pure function and unit-tested without a browser. The
 * installer in menus.ts is the only part that talks to `chrome.contextMenus`.
 */
import { type Group, type Id, type Node, SYSTEM_GROUP_IDS } from "../data/model";

export type MenuContext = "action" | "page" | "link";

export interface MenuItemSpec {
  id: string;
  /** Resolved with `t()` by the installer, so this module stays locale-free. */
  titleKey: string;
  titleVars?: Record<string, string | number>;
  /** Omitted for submenu children, which inherit from the parent. */
  contexts?: MenuContext[];
  parentId?: string;
  type?: "separator" | "checkbox";
  enabled?: boolean;
  checked?: boolean;
}

export const MENU_ID = {
  openLibrary: "tn-open-library",
  parkWindow: "tn-park-window",
  parkTabGroup: "tn-park-tab-group",
  parkSelection: "tn-park-selection",
  parkCurrentTab: "tn-park-current-tab",
  parkAllExceptCurrent: "tn-park-all-except",
  parkLeft: "tn-park-left",
  parkRight: "tn-park-right",
  parkAllWindows: "tn-park-all-windows",
  toggleExclude: "tn-toggle-exclude",
  recentGroups: "tn-recent-groups",
  recentChildPrefix: "tn-recent:",
  recentEmpty: "tn-recent-empty",
  help: "tn-help",
  parkLink: "tn-park-link",
  separator: "tn-separator",
} as const;

export interface RecentGroup {
  id: Id;
  label: string;
}

export interface MenuInput {
  /** Hostname of the tab the menu was opened on; null for chrome:// and friends. */
  activeHost: string | null;
  /** Whether that host is already in the excluded list. */
  excluded: boolean;
  /** Whether the tab belongs to a Chrome tab group. */
  inTabGroup: boolean;
  /** How many tabs are highlighted in that window. */
  highlightedCount: number;
  recentGroups: RecentGroup[];
  /** Cap for the submenu; kept small so the menu stays scannable. */
  recentLimit?: number;
}

const PARK_CONTEXTS: MenuContext[] = ["action", "page"];

export function buildMenuSpec(input: MenuInput): MenuItemSpec[] {
  const limit = input.recentLimit ?? 6;
  const items: MenuItemSpec[] = [];

  items.push({ id: MENU_ID.openLibrary, titleKey: "menu.openLibrary", contexts: PARK_CONTEXTS });
  items.push({ id: MENU_ID.separator, titleKey: "", type: "separator", contexts: PARK_CONTEXTS });

  items.push({ id: MENU_ID.parkWindow, titleKey: "menu.parkWindowAll", contexts: PARK_CONTEXTS });
  items.push({
    id: MENU_ID.parkTabGroup,
    titleKey: "menu.parkTabGroupAll",
    contexts: PARK_CONTEXTS,
    enabled: input.inTabGroup,
  });
  items.push({
    id: MENU_ID.parkSelection,
    titleKey: "menu.parkSelection",
    titleVars: { count: input.highlightedCount },
    // Chrome has no "selected tabs" API, but a multi-tab highlight is exactly
    // that, so this is enabled only when more than one tab is highlighted.
    contexts: PARK_CONTEXTS,
    enabled: input.highlightedCount >= 2,
  });

  items.push({
    id: `${MENU_ID.separator}-2`,
    titleKey: "",
    type: "separator",
    contexts: PARK_CONTEXTS,
  });

  items.push({
    id: MENU_ID.parkCurrentTab,
    titleKey: "menu.parkCurrentTab",
    contexts: PARK_CONTEXTS,
  });
  items.push({
    id: MENU_ID.parkAllExceptCurrent,
    titleKey: "menu.parkAllExceptCurrent",
    contexts: PARK_CONTEXTS,
  });
  items.push({ id: MENU_ID.parkLeft, titleKey: "menu.parkLeft", contexts: PARK_CONTEXTS });
  items.push({ id: MENU_ID.parkRight, titleKey: "menu.parkRight", contexts: PARK_CONTEXTS });
  items.push({
    id: MENU_ID.parkAllWindows,
    titleKey: "menu.parkAllWindows",
    contexts: PARK_CONTEXTS,
  });

  if (input.activeHost) {
    items.push({
      id: `${MENU_ID.separator}-3`,
      titleKey: "",
      type: "separator",
      contexts: PARK_CONTEXTS,
    });
    items.push({
      id: MENU_ID.toggleExclude,
      titleKey: "menu.excludeHost",
      titleVars: { host: input.activeHost },
      contexts: PARK_CONTEXTS,
      type: "checkbox",
      checked: input.excluded,
    });
  }

  const recent = input.recentGroups.slice(0, limit);
  items.push({
    id: MENU_ID.recentGroups,
    titleKey: "menu.recentGroups",
    contexts: ["action"],
  });
  if (recent.length === 0) {
    items.push({
      id: MENU_ID.recentEmpty,
      titleKey: "menu.recentEmpty",
      parentId: MENU_ID.recentGroups,
      enabled: false,
    });
  } else {
    for (const group of recent) {
      items.push({
        id: `${MENU_ID.recentChildPrefix}${group.id}`,
        titleKey: "menu.recentGroup",
        titleVars: { label: group.label },
        parentId: MENU_ID.recentGroups,
      });
    }
  }

  items.push({
    id: `${MENU_ID.separator}-4`,
    titleKey: "",
    type: "separator",
    contexts: ["action"],
  });
  items.push({ id: MENU_ID.help, titleKey: "menu.help", contexts: PARK_CONTEXTS });

  // Links keep their own single action.
  items.push({ id: MENU_ID.parkLink, titleKey: "menu.parkLink", contexts: ["link"] });

  return items;
}

/** `tn-recent:<id>` → `<id>`, or null for anything else. */
export function recentGroupIdFromMenuId(menuId: string): Id | null {
  if (!menuId.startsWith(MENU_ID.recentChildPrefix)) return null;
  const id = menuId.slice(MENU_ID.recentChildPrefix.length);
  return id.length > 0 ? id : null;
}

/** Recent groups for the submenu: newest first, labelled, capped by the caller. */
export function recentGroupsFrom(nodes: readonly Node[], limit = 6): RecentGroup[] {
  return nodes
    .filter(
      (node): node is Group =>
        node.kind === "group" &&
        // The trash is a folder too, and the root/quick list are containers, not
        // destinations, so the submenu must skip them explicitly.
        !SYSTEM_GROUP_IDS.includes(node.id) &&
        (node.groupType === "folder" ||
          node.groupType === "window" ||
          node.groupType === "tabGroup"),
    )
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, limit)
    .map((node) => ({
      id: node.id,
      label: (node.label ?? "").trim() || "Untitled",
    }));
}
