/**
 * Request router. One place maps a message to a repository call, so the pages
 * stay free of business logic and the service worker stays the only writer.
 */

import type { Id } from "../data/model";
import {
  type CommitParkResult,
  commitPark,
  createGroup,
  deleteNodes,
  getSettings,
  loadSnapshot,
  moveNodes,
  patchSettings,
  prepareTabs,
  repair,
  restoreNodes,
  setQuickList,
  updateGroup,
  updateTab,
  updateTabUrl,
} from "../data/repo";
import type { BroadcastMessage, RequestMessage, ResponseFor } from "../types/messages";
import { describeOutcome, park } from "./capture";
import { openNodes } from "./open";
import { syncEngine } from "./sync/engine";

export async function broadcast(message: BroadcastMessage): Promise<void> {
  try {
    await chrome.runtime.sendMessage(message);
  } catch {
    // No page is listening; that is the normal case.
  }
}

function changed(ids: Id[]): void {
  void broadcast({ type: "data-changed", ids });
  // A local mutation is a sync candidate; the engine debounces.
  syncEngine.schedule();
}

export async function handle(request: RequestMessage): Promise<unknown> {
  switch (request.type) {
    case "ping":
      return { ok: true as const, version: chrome.runtime.getManifest().version, at: Date.now() };

    case "snapshot":
      return loadSnapshot();

    case "settings":
      return getSettings();

    case "park": {
      const outcome = await park(request.scope);
      changed(outcome.groupIds);
      return { ...outcome, summary: describeOutcome(outcome) };
    }

    case "open": {
      const opened = await openNodes(request.ids, { mode: request.mode });
      return { opened };
    }

    case "update-tab": {
      await updateTab(request.id, {
        ...(request.patch.title === undefined ? {} : { title: request.patch.title }),
        ...(request.patch.notes === undefined ? {} : { notes: request.patch.notes }),
        ...(request.patch.rating === undefined
          ? {}
          : { rating: (request.patch.rating ?? 0) as 0 | 1 | 2 | 3 | 4 | 5 }),
        ...(request.patch.archived === undefined
          ? {}
          : { archivedAt: request.patch.archived ? Date.now() : null }),
      });
      changed([request.id]);
      return { ok: true as const };
    }

    case "update-tab-url": {
      const id = await updateTabUrl(request.id, request.url);
      changed([request.id, id]);
      return { id };
    }

    case "update-group": {
      await updateGroup(request.id, request.patch);
      changed([request.id]);
      return { ok: true as const };
    }

    case "create-group": {
      const id = await createGroup(request.label, request.parentId ?? "root", "folder");
      changed([id]);
      return { id };
    }

    case "move": {
      await moveNodes(request.ids, request.parentId, request.index);
      changed(request.ids);
      return { ok: true as const };
    }

    case "delete": {
      const removed = await deleteNodes(request.ids, request.mode);
      changed(request.ids);
      return { removed };
    }

    case "restore": {
      const restored = await restoreNodes(request.ids);
      changed(request.ids);
      return { restored };
    }

    case "quick-list": {
      await setQuickList(request.id, request.member);
      changed([request.id]);
      return { ok: true as const };
    }

    case "patch-settings": {
      const settings = await patchSettings(request.patch);
      changed([]);
      return settings;
    }

    case "import": {
      const result = await importUrls(request.items, request.label);
      changed([result.groupId]);
      return result;
    }

    case "sync-get":
      return syncEngine.status();

    case "sync-configure":
      return syncEngine.configure({
        backendId: request.backendId,
        ...(request.storeId === undefined ? {} : { storeId: request.storeId }),
        ...(request.options === undefined ? {} : { options: request.options }),
        ...(request.passphrase === undefined ? {} : { passphrase: request.passphrase }),
      });

    case "sync-now":
      return syncEngine.syncNow();

    case "sync-disable":
      return syncEngine.disable();

    case "repair": {
      const report = await repair();
      const repaired =
        report.danglingChildren + report.missingBacklinks + report.duplicateChildren > 0;
      changed([]);
      return { repaired };
    }

    default:
      throw new Error(`unhandled request ${(request as { type: string }).type}`);
  }
}

/**
 * Imports a list of URLs as one group. Used by the import dialog; kept here so
 * the import page never computes ids itself.
 */
export async function importUrls(
  urls: readonly { url: string; title?: string }[],
  groupLabel: string,
): Promise<{ added: number; skipped: number; groupId: Id }> {
  const prepared = await prepareTabs(urls);
  const result = await commitPark(prepared, { groupLabel, groupType: "folder" });
  changed([result.groupId]);
  return result;
}

export type { ResponseFor };
/** Adds a single URL (context-menu "park this link") to the root list. */
export async function addLink(url: string, title?: string): Promise<CommitParkResult> {
  const prepared = await prepareTabs([title === undefined ? { url } : { url, title }]);
  const result = await commitPark(prepared, { targetParentId: "root" });
  changed([result.groupId]);
  return result;
}

/** Settings are read by the pages through the snapshot; this is for commands. */
export { getSettings };
