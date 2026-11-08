/**
 * In-memory object store, used by tests to give two engines one shared server.
 * It is also the reference for how small a backend can be.
 */
import type { ObjectStore, ObjectStoreCaps, Usage } from "./types";

export interface MemoryStoreOptions {
  caps?: Partial<ObjectStoreCaps>;
  /** Called after every write, so a test can act as "the other device". */
  onChange?: () => void;
}

export function createMemoryStore(
  id: string,
  shared: Map<string, Uint8Array>,
  options: MemoryStoreOptions = {},
): ObjectStore {
  const caps: ObjectStoreCaps = {
    maxBytes: 5_600,
    supportsList: true,
    ...options.caps,
  };

  const used = (): number => {
    let total = 0;
    for (const value of shared.values()) total += value.length;
    return total;
  };

  return {
    id,
    caps,

    async get(key) {
      const value = shared.get(key);
      return value ? new Uint8Array(value) : null;
    },

    async put(key, bytes) {
      if (bytes.length > caps.maxBytes) {
        throw new Error(`chunk of ${bytes.length} bytes exceeds the ${caps.maxBytes} byte limit`);
      }
      if (caps.maxTotalBytes !== undefined) {
        const after = used() - (shared.get(key)?.length ?? 0) + bytes.length;
        if (after > caps.maxTotalBytes) {
          throw new Error(`store would exceed ${caps.maxTotalBytes} bytes`);
        }
      }
      shared.set(key, new Uint8Array(bytes));
      options.onChange?.();
    },

    async del(key) {
      shared.delete(key);
      options.onChange?.();
    },

    async list(prefix) {
      return [...shared.keys()].filter((key) => key.startsWith(prefix)).sort();
    },

    async usage(): Promise<Usage> {
      return {
        used: used(),
        ...(caps.maxTotalBytes === undefined ? {} : { quota: caps.maxTotalBytes }),
      };
    },
  };
}
