/**
 * The manual backend: an object store that lives in memory and can be written to
 * a file or loaded from one. It exists so a user can move a library between
 * machines, or keep an offline backup, without any server at all.
 */
import type { ObjectStore, ObjectStoreCaps } from "./types";

const CAPS: ObjectStoreCaps = {
  maxBytes: 64 * 1024 * 1024,
  supportsList: true,
};

export interface ArchiveFile {
  format: "tabnest-sync-archive";
  version: 1;
  createdAt: number;
  entries: Record<string, string>;
}

export function createFileStore(initial?: Record<string, string>): ObjectStore & {
  toArchive(): ArchiveFile;
  loadArchive(archive: ArchiveFile): void;
} {
  const entries = new Map<string, Uint8Array>();
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  if (initial) {
    for (const [key, value] of Object.entries(initial)) entries.set(key, encoder.encode(value));
  }

  return {
    id: "file",
    caps: CAPS,

    async get(key) {
      const value = entries.get(key);
      return value ? new Uint8Array(value) : null;
    },

    async put(key, bytes) {
      entries.set(key, new Uint8Array(bytes));
    },

    async del(key) {
      entries.delete(key);
    },

    async list(prefix) {
      return [...entries.keys()].filter((key) => key.startsWith(prefix)).sort();
    },

    toArchive() {
      const out: Record<string, string> = {};
      for (const [key, value] of entries) out[key] = decoder.decode(value);
      return {
        format: "tabnest-sync-archive",
        version: 1,
        createdAt: Date.now(),
        entries: out,
      };
    },

    loadArchive(archive) {
      entries.clear();
      for (const [key, value] of Object.entries(archive.entries)) {
        entries.set(key, encoder.encode(value));
      }
    },
  };
}
