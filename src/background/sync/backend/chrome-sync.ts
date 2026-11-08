/**
 * chrome.storage.sync as an object store.
 *
 * Limits: 100 KiB total, 8 KiB per entry, 512 entries, 120 writes per minute.
 * Values are stored as base64 strings, so a 6 KiB blob becomes ~8 KiB of JSON
 * once base64 and quoting are accounted for — hence the conservative maxBytes.
 */
import { fromBase64, toBase64 } from "../crypto";
import { BackendError, type ObjectStore, type ObjectStoreCaps, type Usage } from "./types";

const CAPS: ObjectStoreCaps = {
  maxBytes: 5_600,
  maxTotalBytes: 102_400,
  maxObjects: 512,
  writesPerMinute: 120,
  supportsList: true,
};

export function createChromeSyncStore(): ObjectStore {
  return {
    id: "chrome-sync",
    caps: CAPS,

    async get(key) {
      const result = await chrome.storage.sync.get(key);
      const value = result[key];
      if (typeof value !== "string") return null;
      return fromBase64(value);
    },

    async put(key, bytes) {
      try {
        await chrome.storage.sync.set({ [key]: toBase64(bytes) });
      } catch (error) {
        throw new BackendError(
          error instanceof Error ? error.message : "chrome.storage.sync rejected the write",
        );
      }
    },

    async del(key) {
      await chrome.storage.sync.remove(key);
    },

    async list(prefix) {
      const all = await chrome.storage.sync.get(null);
      return Object.keys(all).filter((key) => key.startsWith(prefix));
    },

    watch(callback) {
      const listener = (
        changes: Record<string, chrome.storage.StorageChange>,
        area: string,
      ): void => {
        if (area !== "sync") return;
        if (Object.keys(changes).some((key) => key.includes("/d/"))) callback();
      };
      chrome.storage.onChanged.addListener(listener);
      return () => chrome.storage.onChanged.removeListener(listener);
    },

    async usage(): Promise<Usage> {
      const used = await chrome.storage.sync.getBytesInUse(null);
      return { used, quota: CAPS.maxTotalBytes ?? 102_400 };
    },
  };
}
