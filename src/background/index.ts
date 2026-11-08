/**
 * Service worker entry point.
 *
 * Responsibilities, in order of importance:
 *   1. route page requests to the repository (single writer),
 *   2. turn commands, context-menu clicks and shortcuts into parking operations,
 *   3. keep the alarms that maintenance and sync run on.
 */

import { isKnownRequest, type RequestMessage } from "../types/messages";
import type { ParkScope } from "./capture";
import { park } from "./capture";
import { sweep } from "./maintenance";
import { installMenus, MENU } from "./menus";
import { addLink, broadcast, handle } from "./router";
import { syncEngine } from "./sync/engine";

const ALARM_SYNC_TICK = "sync-tick";
const ALARM_MAINTENANCE = "maintenance-tick";

function version(): string {
  return chrome.runtime.getManifest().version;
}

function log(...args: unknown[]): void {
  console.debug("[tabnest:sw]", ...args);
}

async function openLibrary(): Promise<void> {
  const url = chrome.runtime.getURL("pages/library.html");
  const existing = await chrome.tabs.query({ url });
  const first = existing[0];
  if (first?.id !== undefined) {
    await chrome.tabs.update(first.id, { active: true });
    if (first.windowId !== undefined) {
      await chrome.windows.update(first.windowId, { focused: true });
    }
    return;
  }
  await chrome.tabs.create({ url });
}

async function flashBadge(text: string): Promise<void> {
  await chrome.action.setBadgeText({ text });
  if (text) {
    await chrome.action.setBadgeBackgroundColor({ color: "#4f46e5" });
    setTimeout(() => {
      void chrome.action.setBadgeText({ text: "" });
    }, 4000);
  }
}

async function parkWithFeedback(scope: ParkScope): Promise<void> {
  try {
    const outcome = await park(scope);
    if (outcome.refusedDueToPinned) {
      await flashBadge("!");
      return;
    }
    await flashBadge(outcome.added > 0 ? String(outcome.added) : "");
  } catch (error) {
    log("park failed", error);
    await flashBadge("!");
  }
}

function scheduleAlarms(): void {
  chrome.alarms.create(ALARM_SYNC_TICK, { periodInMinutes: 1 });
  chrome.alarms.create(ALARM_MAINTENANCE, { periodInMinutes: 60 * 24, delayInMinutes: 5 });
}

chrome.runtime.onInstalled.addListener((details) => {
  log("onInstalled", details.reason, version());
  installMenus();
  scheduleAlarms();
});

chrome.runtime.onStartup.addListener(() => {
  log("onStartup", version());
  installMenus();
  scheduleAlarms();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_MAINTENANCE) {
    void sweep()
      .then((result) => log("sweep", result))
      .catch((error) => log("sweep failed", error));
    return;
  }
  if (alarm.name === ALARM_SYNC_TICK) {
    void syncEngine.syncNow().catch((error) => log("sync tick failed", error));
  }
});

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (!isKnownRequest(message)) return false;
  const request = message as RequestMessage;

  handle(request)
    .then((result) => sendResponse(result))
    .catch((error: unknown) => {
      log("request failed", request.type, error);
      sendResponse({ error: error instanceof Error ? error.message : String(error) });
    });

  return true; // keep the channel open for the async reply
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  switch (info.menuItemId) {
    case MENU.openLibrary:
      void openLibrary();
      return;
    case MENU.parkWindow:
      void parkWithFeedback({ kind: "window" });
      return;
    case MENU.parkPage:
      if (tab?.id !== undefined) void parkWithFeedback({ kind: "tabs", tabIds: [tab.id] });
      return;
    case MENU.parkGroup:
      void parkWithFeedback({
        kind: "tab-group",
        ...(tab?.windowId === undefined ? {} : { windowId: tab.windowId }),
      });
      return;
    case MENU.parkLink:
      if (info.linkUrl) {
        void addLink(info.linkUrl, info.selectionText)
          .then((result) => flashBadge(result.added > 0 ? "+1" : ""))
          .catch((error) => log("park link failed", error));
      }
      return;
    default:
  }
});

chrome.commands.onCommand.addListener((command) => {
  switch (command) {
    case "display-library":
      void openLibrary();
      return;
    case "park-current-tab":
      void parkWithFeedback({ kind: "current-tab" });
      return;
    case "park-window":
      void parkWithFeedback({ kind: "window" });
      return;
    case "park-tab-group":
      void parkWithFeedback({ kind: "tab-group" });
      return;
    case "park-all-except-current":
      void parkWithFeedback({ kind: "all-except-current" });
      return;
    case "park-left":
      void parkWithFeedback({ kind: "left" });
      return;
    case "park-right":
      void parkWithFeedback({ kind: "right" });
      return;
    case "park-all-windows":
      void parkWithFeedback({ kind: "all-windows" });
      return;
    default:
      log("unknown command", command);
  }
});

syncEngine.onStatus((status) => {
  void broadcast({ type: "sync-status", ...status });
});

void (async () => {
  installMenus();
  scheduleAlarms();
  await syncEngine.init();
  log("ready", version());
})();
