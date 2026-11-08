/**
 * Service worker entry point.
 *
 * A list of subscriptions and nothing else: routing, the action menu, keyboard
 * commands, alarms. Behaviour lives in actions.ts, menus.ts and router.ts.
 */

import { isKnownRequest, type RequestMessage } from "../types/messages";
import { handleCommand, handleMenuClick } from "./actions";
import { sweep } from "./maintenance";
import { installMenus, scheduleMenuRebuild } from "./menus";
import { broadcast, handle } from "./router";
import { syncEngine } from "./sync/engine";

const ALARM_SYNC_TICK = "sync-tick";
const ALARM_MAINTENANCE = "maintenance-tick";

function version(): string {
  return chrome.runtime.getManifest().version;
}

function log(...args: unknown[]): void {
  console.debug("[tabnest:sw]", ...args);
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
  void handleMenuClick(info, tab).catch((error) => log("menu action failed", error));
});

chrome.commands.onCommand.addListener((command) => {
  void handleCommand(command).catch((error) => log("command failed", error));
});

// The menu's shape depends on the focused tab, its tab group, the highlight set
// and the newest lists, so it is rebuilt whenever one of those can have changed.
const menuRelevant = (): void => scheduleMenuRebuild();

chrome.tabs.onActivated.addListener(menuRelevant);
chrome.tabs.onHighlighted.addListener(menuRelevant);
chrome.tabs.onRemoved.addListener(menuRelevant);
chrome.windows.onFocusChanged.addListener(menuRelevant);
chrome.tabs.onUpdated.addListener((_tabId, changeInfo) => {
  if (changeInfo.url !== undefined || changeInfo.groupId !== undefined) scheduleMenuRebuild();
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
