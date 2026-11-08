/**
 * Installs the action menu.
 *
 * The menu is rebuilt rather than mutated: its shape depends on the active tab
 * (which host the exclusion row names), on whether that tab sits in a Chrome tab
 * group, on how many tabs are highlighted, and on which lists were created most
 * recently. Rebuilds are debounced because dragging a tab fires a lot of events.
 */
import { getSettings, listNodes } from "../data/repo";
import { hostOf, isExcludedHost } from "../data/url";
import { initLocale, t } from "../ui/i18n";
import { buildMenuSpec, type MenuInput, recentGroupsFrom } from "./menu-spec";

let rebuildTimer: ReturnType<typeof setTimeout> | null = null;

export function scheduleMenuRebuild(delayMs = 150): void {
  if (rebuildTimer !== null) clearTimeout(rebuildTimer);
  rebuildTimer = setTimeout(() => {
    rebuildTimer = null;
    void rebuildMenus();
  }, delayMs);
}

async function collectInput(): Promise<MenuInput> {
  const [active] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const host = active?.url ? hostOf(active.url) || null : null;

  const settings = await getSettings();
  const highlighted =
    active?.windowId === undefined
      ? []
      : await chrome.tabs.query({ windowId: active.windowId, highlighted: true });

  return {
    activeHost: host,
    excluded: host ? isExcludedHost(host, settings.excludedDomains) : false,
    inTabGroup: (active?.groupId ?? -1) !== -1,
    highlightedCount: highlighted.length,
    recentGroups: recentGroupsFrom(await listNodes(), 6),
  };
}

let generation = 0;

export interface MenuReport {
  installedAt: number;
  items: number;
  errors: string[];
}

/** What the last rebuild did. Diagnostics only; surfaced through a message. */
let report: MenuReport = { installedAt: 0, items: 0, errors: [] };

export function lastMenuReport(): MenuReport {
  return report;
}

export async function rebuildMenus(): Promise<void> {
  initLocale();
  let input: MenuInput;
  try {
    input = await collectInput();
  } catch {
    // No window (for example during shutdown): leave the previous menu alone.
    return;
  }

  const spec = buildMenuSpec(input);
  const errors: string[] = [];
  const mine = ++generation;

  await new Promise<void>((resolve) => {
    chrome.contextMenus.removeAll(() => resolve());
  });
  // A newer rebuild started while removeAll was in flight; let it win.
  if (mine !== generation) return;

  for (const item of spec) {
    const contexts = item.contexts as
      | [chrome.contextMenus.ContextType, ...chrome.contextMenus.ContextType[]]
      | undefined;
    const base = {
      id: item.id,
      ...(contexts ? { contexts } : {}),
      ...(item.parentId ? { parentId: item.parentId } : {}),
    };

    // Separators, checkboxes and plain items are different shapes in Chrome's
    // typings, so each is built explicitly rather than by spreading options.
    let properties: chrome.contextMenus.CreateProperties;
    if (item.type === "separator") {
      properties = { ...base, type: "separator" };
    } else if (item.type === "checkbox") {
      properties = {
        ...base,
        type: "checkbox",
        title: t(item.titleKey, item.titleVars),
        checked: item.checked === true,
        ...(item.enabled === undefined ? {} : { enabled: item.enabled }),
      };
    } else {
      properties = {
        ...base,
        title: t(item.titleKey, item.titleVars),
        ...(item.enabled === undefined ? {} : { enabled: item.enabled }),
      };
    }

    // A failed create (duplicate id, missing parent) must not stop the rest, but
    // it must not vanish either: the reason is kept for diagnostics.
    const error = await new Promise<string | undefined>((resolve) => {
      chrome.contextMenus.create(properties, () => {
        resolve(chrome.runtime.lastError?.message);
      });
    });
    if (error) errors.push(`${item.id}: ${error}`);
  }

  report = { installedAt: Date.now(), items: spec.length, errors };
}

export function installMenus(): void {
  scheduleMenuRebuild(0);
}
