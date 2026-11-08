import { createChromeSyncStore } from "./chrome-sync";
import type { BackendDescriptor, BackendOptions, ObjectStore } from "./types";

/**
 * Registered backends. M4 ships chrome.storage.sync; M5 adds the network ones
 * behind the same interface, so the engine never learns a new concept.
 */
export const BACKENDS: BackendDescriptor[] = [
  {
    id: "chrome-sync",
    labelKey: "sync.backend.chromeSync",
    needsConfig: false,
    encryption: "off",
    create: async () => createChromeSyncStore(),
  },
];

const extra = new Map<string, BackendDescriptor>();

/** Used by tests, and by M5 for backends that need runtime configuration. */
export function registerBackend(descriptor: BackendDescriptor): void {
  extra.set(descriptor.id, descriptor);
}

export function listBackends(): BackendDescriptor[] {
  return [...BACKENDS, ...extra.values()];
}

export function findBackend(id: string): BackendDescriptor | undefined {
  return listBackends().find((backend) => backend.id === id);
}

export async function createStore(id: string, options: BackendOptions): Promise<ObjectStore> {
  const descriptor = findBackend(id);
  if (!descriptor) throw new Error(`unknown sync backend: ${id}`);
  return descriptor.create(options);
}

export type { BackendDescriptor, BackendOptions, ObjectStore };
