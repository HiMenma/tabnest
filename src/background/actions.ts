/**
 * Everything that happens because the user asked for it: menu clicks, keyboard
 * commands, and opening our own pages. Kept apart from the service-worker entry
 * point so the menu dispatcher can be unit-tested and so `index.ts` stays a list
 * of event subscriptions.
 */

import type { Id } from "../data/model";
import { getSettings, patchSettings } from "../data/repo";
import { hostOf, isExcludedHost } from "../data/url";
import { type ParkScope, park } from "./capture";
import { MENU_ID, recentGroupIdFromMenuId } from "./menu-spec";
import { scheduleMenuRebuild } from "./menus";
import { addLink } from "./router";

export async function openPage(path: string): Promise<chrome.tabs.Tab> {
  return chrome.tabs.create({ url: chrome.runtime.getURL(path) });
}

export async function openLibrary(groupId?: Id): Promise<void> {
  const base = chrome.runtime.getURL("pages/library.html");
  const url = groupId ? `${base}?group=${encodeURIComponent(groupId)}` : base;

  if (!groupId) {
    const [existing] = await chrome.tabs.query({ url: base });
    if (existing?.id !== undefined) {
      await chrome.tabs.update(existing.id, { active: true });
      if (existing.windowId !== undefined) {
        await chrome.windows.update(existing.windowId, { focused: true });
      }
      return;
    }
  }
  await chrome.tabs.create({ url });
}

export async function flashBadge(text: string): Promise<void> {
  await chrome.action.setBadgeText({ text });
  if (text) {
    await chrome.action.setBadgeBackgroundColor({ color: "#4f46e5" });
    setTimeout(() => {
      void chrome.action.setBadgeText({ text: "" });
    }, 4000);
  }
}

export async function parkWithFeedback(scope: ParkScope): Promise<void> {
  try {
    const outcome = await park(scope);
    if (outcome.refusedDueToPinned) {
      await flashBadge("!");
      return;
    }
    await flashBadge(outcome.added > 0 ? String(outcome.added) : "");
  } catch (error) {
    console.debug("[tabnest:sw] park failed", error);
    await flashBadge("!");
  }
}

/** Toggles the active host in and out of the exclusion list. */
export async function toggleHostExclusion(
  rawUrl: string | undefined,
  excluded: boolean,
): Promise<void> {
  const host = rawUrl ? hostOf(rawUrl) : "";
  if (!host) return;

  const settings = await getSettings();
  const current = settings.excludedDomains;
  const already = isExcludedHost(host, current);

  if (excluded && !already) {
    await patchSettings({ excludedDomains: [...current, host] });
  } else if (!excluded && already) {
    await patchSettings({
      excludedDomains: current.filter((pattern) => pattern.trim().toLowerCase() !== host),
    });
  }
  scheduleMenuRebuild(0);
}

const SCOPE_BY_MENU_ID: Record<string, ParkScope | undefined> = {
  [MENU_ID.parkWindow]: { kind: "window" },
  [MENU_ID.parkTabGroup]: { kind: "tab-group" },
  [MENU_ID.parkCurrentTab]: { kind: "current-tab" },
  [MENU_ID.parkAllExceptCurrent]: { kind: "all-except-current" },
  [MENU_ID.parkLeft]: { kind: "left" },
  [MENU_ID.parkRight]: { kind: "right" },
  [MENU_ID.parkAllWindows]: { kind: "all-windows" },
};

export async function handleMenuClick(
  info: chrome.contextMenus.OnClickData,
  tab: chrome.tabs.Tab | undefined,
): Promise<void> {
  const menuId = String(info.menuItemId);

  const recentGroup = recentGroupIdFromMenuId(menuId);
  if (recentGroup) {
    await openLibrary(recentGroup);
    return;
  }

  if (menuId === MENU_ID.openLibrary) {
    await openLibrary();
    return;
  }

  if (menuId === MENU_ID.help) {
    await openPage("pages/help.html");
    return;
  }

  if (menuId === MENU_ID.toggleExclude) {
    await toggleHostExclusion(tab?.url ?? info.pageUrl, info.checked === true);
    return;
  }

  if (menuId === MENU_ID.parkLink) {
    if (info.linkUrl) {
      const result = await addLink(info.linkUrl, info.selectionText);
      await flashBadge(result.added > 0 ? "+1" : "");
    }
    return;
  }

  if (menuId === MENU_ID.parkSelection) {
    const windowId = tab?.windowId;
    const highlighted = await chrome.tabs.query({
      highlighted: true,
      ...(windowId === undefined ? { lastFocusedWindow: true } : { windowId }),
    });
    const tabIds = highlighted
      .map((entry) => entry.id)
      .filter((id): id is number => typeof id === "number");
    if (tabIds.length > 0) await parkWithFeedback({ kind: "tabs", tabIds });
    return;
  }

  const scope = scopeForMenuId(menuId);
  if (scope) await parkWithFeedback(scopeInWindow(scope, tab?.windowId));
}

/** The park scope a menu item maps to, if any. Exported for tests. */
export function scopeForMenuId(menuId: string): ParkScope | undefined {
  return SCOPE_BY_MENU_ID[menuId];
}

/** Only some scopes take a window id; the others act on "the current window". */
function scopeInWindow(scope: ParkScope, windowId: number | undefined): ParkScope {
  if (windowId === undefined) return scope;
  switch (scope.kind) {
    case "window":
    case "tab-group":
    case "all-except-current":
    case "left":
    case "right":
      return { ...scope, windowId };
    default:
      return scope;
  }
}

const COMMAND_SCOPES: Record<string, ParkScope | undefined> = {
  "park-current-tab": { kind: "current-tab" },
  "park-window": { kind: "window" },
  "park-tab-group": { kind: "tab-group" },
  "park-all-except-current": { kind: "all-except-current" },
  "park-left": { kind: "left" },
  "park-right": { kind: "right" },
  "park-all-windows": { kind: "all-windows" },
};

/** Keyboard commands share the same scopes as the menu. */
export async function handleCommand(command: string): Promise<void> {
  if (command === "display-library") {
    await openLibrary();
    return;
  }
  const scope = COMMAND_SCOPES[command];
  if (scope) {
    await parkWithFeedback(scope);
    return;
  }
  console.debug("[tabnest:sw] unknown command", command);
}
