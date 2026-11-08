/**
 * Service worker entry point.
 *
 * Responsibilities, in order of importance:
 *   1. route page requests to the repository (single writer),
 *   2. turn commands and context-menu clicks into parking operations,
 *   3. keep alarms alive for the sync engine.
 */

import { isKnownRequest, type RequestMessage } from "../types/messages";
import type { ParkScope } from "./capture";
import { park } from "./capture";
import { handle } from "./router";

const ALARM_SYNC_TICK = "sync-tick";

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

chrome.runtime.onInstalled.addListener((details) => {
  log("onInstalled", details.reason, version());
  chrome.alarms.create(ALARM_SYNC_TICK, { periodInMinutes: 1 });
});

chrome.runtime.onStartup.addListener(() => {
  log("onStartup", version());
  chrome.alarms.create(ALARM_SYNC_TICK, { periodInMinutes: 1 });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_SYNC_TICK) {
    // M4: the sync engine hooks in here.
    log("alarm", ALARM_SYNC_TICK);
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

void (async () => {
  chrome.alarms.create(ALARM_SYNC_TICK, { periodInMinutes: 1 });
  log("ready", version());
})();
