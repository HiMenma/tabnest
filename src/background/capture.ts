/**
 * Capture: turning live tabs into records.
 *
 * All filtering happens here, before anything is written, so a refused park
 * leaves the browser untouched. The order is deliberate:
 *   gather -> classify -> prepare ids -> commit -> close.
 * A failure before commit closes nothing; a failure while closing is reported but
 * does not roll back the records.
 */

import type { Id, Settings } from "../data/model";
import {
  type CommitParkResult,
  commitPark,
  createGroup,
  deleteNodes,
  getSettings,
  type PreparedTab,
  prepareTabs,
  quarantineUrls,
} from "../data/repo";
import { hostOf, isExcludedHost, isParkable, isTooLong } from "../data/url";

export type ParkScope =
  | { kind: "current-tab" }
  | { kind: "window"; windowId?: number }
  | { kind: "tab-group"; windowId?: number }
  | { kind: "all-except-current"; windowId?: number }
  | { kind: "left"; windowId?: number }
  | { kind: "right"; windowId?: number }
  | { kind: "all-windows" }
  | { kind: "tabs"; tabIds: number[] };

/** `chrome.tabGroups` is absent unless the optional permission is granted. */
const NO_TAB_GROUP = -1;

function hasTabGroupsApi(): boolean {
  return typeof chrome.tabGroups?.get === "function";
}

export interface ParkOutcome {
  added: number;
  skipped: number;
  excluded: number;
  pinnedSkipped: number;
  quarantined: number;
  /** Groups created, in order. Empty when everything was skipped. */
  groupIds: Id[];
  closedTabs: number;
  /** True when the pinned policy refused the operation. */
  refusedDueToPinned: boolean;
}

interface Candidate {
  tab: chrome.tabs.Tab;
  id: number;
}

function isRecordable(tab: chrome.tabs.Tab): boolean {
  return typeof tab.id === "number" && typeof tab.url === "string" && isParkable(tab.url);
}

function activeTabOf(tabs: chrome.tabs.Tab[]): chrome.tabs.Tab | undefined {
  return tabs.find((tab) => tab.active);
}

async function resolveWindowId(windowId?: number): Promise<number> {
  if (windowId !== undefined) return windowId;
  const current = await chrome.windows.getCurrent();
  if (current.id === undefined) throw new Error("no current window");
  return current.id;
}

async function gather(scope: ParkScope): Promise<chrome.tabs.Tab[]> {
  switch (scope.kind) {
    case "current-tab": {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      return tab ? [tab] : [];
    }
    case "tabs": {
      const tabs = await Promise.all(
        scope.tabIds.map((id) => chrome.tabs.get(id).catch(() => undefined)),
      );
      return tabs.filter((tab): tab is chrome.tabs.Tab => tab !== undefined);
    }
    case "all-windows": {
      return chrome.tabs.query({});
    }
    case "window": {
      const windowId = await resolveWindowId(scope.windowId);
      return (await chrome.tabs.query({ windowId })).sort((a, b) => a.index - b.index);
    }
    case "tab-group": {
      const windowId = await resolveWindowId(scope.windowId);
      const tabs = (await chrome.tabs.query({ windowId })).sort((a, b) => a.index - b.index);
      const activeGroupId = activeTabOf(tabs)?.groupId;
      if (activeGroupId === undefined || activeGroupId === NO_TAB_GROUP) {
        return [];
      }
      return tabs.filter((tab) => tab.groupId === activeGroupId);
    }
    case "all-except-current": {
      const windowId = await resolveWindowId(scope.windowId);
      const tabs = (await chrome.tabs.query({ windowId })).sort((a, b) => a.index - b.index);
      const active = activeTabOf(tabs);
      return tabs.filter((tab) => tab.id !== active?.id);
    }
    case "left":
    case "right": {
      const windowId = await resolveWindowId(scope.windowId);
      const tabs = (await chrome.tabs.query({ windowId })).sort((a, b) => a.index - b.index);
      const active = activeTabOf(tabs);
      if (!active) return [];
      const pivot = active.index;
      return tabs.filter((tab) => (scope.kind === "left" ? tab.index < pivot : tab.index > pivot));
    }
    default:
      return [];
  }
}

interface Classification {
  candidates: Candidate[];
  excluded: chrome.tabs.Tab[];
  pinned: chrome.tabs.Tab[];
  oversized: string[];
}

function classify(tabs: chrome.tabs.Tab[], settings: Settings): Classification {
  const result: Classification = { candidates: [], excluded: [], pinned: [], oversized: [] };

  for (const tab of tabs) {
    if (tab.pinned && settings.pinned !== "park") {
      result.pinned.push(tab);
      continue;
    }
    if (!isRecordable(tab)) continue;

    const url = tab.url ?? "";
    if (isTooLong(url)) {
      result.oversized.push(url);
      continue;
    }
    const host = hostOf(url);
    if (isExcludedHost(host, settings.excludedDomains)) {
      result.excluded.push(tab);
      continue;
    }
    result.candidates.push({ tab, id: tab.id as number });
  }

  return result;
}

function defaultLabel(tabs: readonly chrome.tabs.Tab[]): string {
  const first = tabs.find((tab) => (tab.title ?? "").trim().length > 0);
  const title = (first?.title ?? "").trim().replace(/\s+/g, " ");
  if (title) return title.slice(0, 80);
  const host = first?.url ? hostOf(first.url) : "";
  return host || "Window";
}

async function labelForTabGroup(groupId: number): Promise<string> {
  if (!hasTabGroupsApi()) return "Tab group";
  try {
    const group = await chrome.tabGroups.get(groupId);
    return (group.title ?? "").trim() || "Tab group";
  } catch {
    return "Tab group";
  }
}

/** Splits candidates by Chrome tab group, preserving tab order. */
function groupByChromeGroup(candidates: readonly Candidate[]): Map<number, Candidate[]> {
  const groups = new Map<number, Candidate[]>();
  for (const candidate of candidates) {
    const groupId = candidate.tab.groupId ?? NO_TAB_GROUP;
    const bucket = groups.get(groupId);
    if (bucket) bucket.push(candidate);
    else groups.set(groupId, [candidate]);
  }
  return groups;
}

async function closeTabs(tabs: readonly chrome.tabs.Tab[]): Promise<number> {
  const ids = tabs.map((tab) => tab.id).filter((id): id is number => typeof id === "number");
  if (ids.length === 0) return 0;
  try {
    await chrome.tabs.remove(ids);
    return ids.length;
  } catch {
    // Close what we can, one by one, so one refusal does not strand the rest.
    let closed = 0;
    for (const id of ids) {
      try {
        await chrome.tabs.remove(id);
        closed += 1;
      } catch {
        // tab already gone
      }
    }
    return closed;
  }
}

async function commitInto(
  targetId: Id,
  prepared: PreparedTab[],
  policy: Settings["alreadyParked"],
): Promise<CommitParkResult> {
  return commitPark(prepared, { targetParentId: targetId, alreadyParked: policy });
}

export async function park(scope: ParkScope): Promise<ParkOutcome> {
  const settings = await getSettings();
  const gathered = await gather(scope);

  if (settings.pinned === "stop" && gathered.some((tab) => tab.pinned)) {
    return {
      added: 0,
      skipped: 0,
      excluded: 0,
      pinnedSkipped: 0,
      quarantined: 0,
      groupIds: [],
      closedTabs: 0,
      refusedDueToPinned: true,
    };
  }

  const { candidates, excluded, pinned, oversized } = classify(gathered, settings);
  await quarantineUrls(oversized);

  const outcome: ParkOutcome = {
    added: 0,
    skipped: 0,
    excluded: excluded.length,
    pinnedSkipped: pinned.length,
    quarantined: oversized.length,
    groupIds: [],
    closedTabs: 0,
    refusedDueToPinned: false,
  };

  if (candidates.length === 0) return outcome;

  const firstGroupId = candidates[0]?.tab.groupId ?? NO_TAB_GROUP;
  const label =
    scope.kind === "all-windows"
      ? ""
      : scope.kind === "tab-group" && firstGroupId !== NO_TAB_GROUP
        ? await labelForTabGroup(firstGroupId)
        : defaultLabel(candidates.map((candidate) => candidate.tab));

  // One window group per source window (or one group for the whole operation).
  const windows = new Map<number, Candidate[]>();
  for (const candidate of candidates) {
    const windowId = candidate.tab.windowId ?? 0;
    const bucket = windows.get(windowId);
    if (bucket) bucket.push(candidate);
    else windows.set(windowId, [candidate]);
  }

  const closeList: chrome.tabs.Tab[] = candidates.map((candidate) => candidate.tab);
  const useTabGroups = settings.tabGroups === "respect" && hasTabGroupsApi();
  // Parking a tab group produces a tabGroup record; anything else produces a
  // window record that may contain tabGroup children.
  const rootGroupType = scope.kind === "tab-group" ? ("tabGroup" as const) : ("window" as const);

  for (const [, windowCandidates] of windows) {
    const windowLabel = windows.size > 1 ? defaultLabel(windowCandidates.map((c) => c.tab)) : label;
    const windowGroupId = await createGroup(windowLabel || "Window", "root", rootGroupType);
    outcome.groupIds.push(windowGroupId);

    let addedIntoWindow = 0;

    if (useTabGroups) {
      for (const [groupId, bucket] of groupByChromeGroup(windowCandidates)) {
        const prepared = await prepareTabs(
          bucket.map((candidate) => ({
            url: candidate.tab.url ?? "",
            title: candidate.tab.title,
          })),
        );
        if (prepared.length === 0) continue;
        const target =
          groupId === NO_TAB_GROUP
            ? windowGroupId
            : await createGroup(await labelForTabGroup(groupId), windowGroupId, "tabGroup");
        if (target !== windowGroupId) outcome.groupIds.push(target);
        const result = await commitInto(target, prepared, settings.alreadyParked);
        outcome.added += result.added;
        outcome.skipped += result.skipped;
        addedIntoWindow += result.added;
      }
    } else {
      const prepared = await prepareTabs(
        windowCandidates.map((candidate) => ({
          url: candidate.tab.url ?? "",
          title: candidate.tab.title,
        })),
      );
      const result = await commitInto(windowGroupId, prepared, settings.alreadyParked);
      outcome.added += result.added;
      outcome.skipped += result.skipped;
      addedIntoWindow += result.added;
    }

    if (addedIntoWindow === 0) {
      // Nothing landed; drop the empty shell (and any subgroups) rather than
      // leaving clutter behind.
      await deleteNodes([windowGroupId], "purge");
      outcome.groupIds = outcome.groupIds.filter((id) => id !== windowGroupId);
    }
  }

  if (settings.closeAfter === "window") {
    outcome.closedTabs = await closeTabs(closeList);
  } else if (settings.closeAfter === "tabGroup") {
    outcome.closedTabs = await closeTabs(
      closeList.filter((tab) => (tab.groupId ?? NO_TAB_GROUP) !== NO_TAB_GROUP),
    );
  }

  return outcome;
}

/** Human-readable summary for the popup and toasts. */
export function describeOutcome(outcome: ParkOutcome): string {
  if (outcome.refusedDueToPinned) return "A pinned tab is in the way";
  const parts = [`${outcome.added} parked`];
  if (outcome.skipped > 0) parts.push(`${outcome.skipped} already saved`);
  if (outcome.excluded > 0) parts.push(`${outcome.excluded} excluded`);
  if (outcome.pinnedSkipped > 0) parts.push(`${outcome.pinnedSkipped} pinned left`);
  if (outcome.quarantined > 0) parts.push(`${outcome.quarantined} too long`);
  return parts.join(" · ");
}
