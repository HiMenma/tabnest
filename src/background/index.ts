/**
 * Service worker entry point.
 *
 * M0 scope: prove the wiring works — install/startup lifecycle, a typed message
 * round trip, one alarm, and the commands that open the library. Capture rules,
 * the repository and the sync engine land in M1/M4.
 */
import { isPing, type PingRequest, type PingResponse } from "../types/messages";

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

function ensureAlarms(): void {
  chrome.alarms.create(ALARM_SYNC_TICK, { periodInMinutes: 1 });
}

chrome.runtime.onInstalled.addListener((details) => {
  log("onInstalled", details.reason, version());
  ensureAlarms();
});

chrome.runtime.onStartup.addListener(() => {
  log("onStartup", version());
  ensureAlarms();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_SYNC_TICK) {
    // M4: hand off to the sync engine scheduler.
    log("alarm", ALARM_SYNC_TICK);
  }
});

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (isPing(message)) {
    const body: PingResponse = { ok: true, version: version(), at: Date.now() };
    sendResponse(body);
    return false;
  }
  return false;
});

chrome.commands.onCommand.addListener((command) => {
  if (command === "display-library") void openLibrary();
  // Parking commands are wired in M1/M2.
  log("command", command);
});

// A worker that wakes on its own should not leave a stale badge behind.
void chrome.action.setBadgeText({ text: "" });

void (async () => {
  ensureAlarms();
  log("ready", version());
})();

// Keep the type import used even when the handler short-circuits.
export type { PingRequest };
