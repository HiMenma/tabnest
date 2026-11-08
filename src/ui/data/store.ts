import { create } from "zustand";
import type { Id, LibrarySnapshot } from "../../data/model";
import { send } from "./client";

export interface LibraryState {
  snapshot: LibrarySnapshot | null;
  selectedGroupId: Id;
  query: string;
  selection: ReadonlySet<Id>;
  loading: boolean;
  error: string | null;

  refresh: () => Promise<void>;
  selectGroup: (id: Id) => void;
  setQuery: (query: string) => void;
  setSelection: (ids: Iterable<Id>) => void;
  toggleSelection: (id: Id, additive: boolean) => void;
  clearSelection: () => void;
  setError: (message: string | null) => void;
}

export const useLibrary = create<LibraryState>()((set, get) => ({
  snapshot: null,
  selectedGroupId: "root",
  query: "",
  selection: new Set<Id>(),
  loading: true,
  error: null,

  refresh: async () => {
    try {
      const snapshot = await send({ type: "snapshot" });
      const present = new Set(snapshot.nodes.map((node) => node.id));
      const selection = new Set([...get().selection].filter((id) => present.has(id)));
      set({ snapshot, loading: false, error: null, selection });
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },

  selectGroup: (id) => set({ selectedGroupId: id, query: "", selection: new Set<Id>() }),
  setQuery: (query) => set({ query }),
  setSelection: (ids) => set({ selection: new Set(ids) }),

  toggleSelection: (id, additive) => {
    const current = get().selection;
    if (!additive) {
      set({ selection: new Set([id]) });
      return;
    }
    const next = new Set(current);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    set({ selection: next });
  },

  clearSelection: () => set({ selection: new Set<Id>() }),
  setError: (message) => set({ error: message }),
}));

let refreshTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleRefresh(): void {
  if (refreshTimer !== null) clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    void useLibrary.getState().refresh();
  }, 80);
}

/** Wires the worker's broadcasts into the store. Returns an unsubscribe fn. */
export function startBroadcastBridge(): () => void {
  const listener = (message: unknown): boolean => {
    const type = (message as { type?: unknown } | null)?.type;
    if (type === "data-changed") scheduleRefresh();
    return false;
  };
  chrome.runtime.onMessage.addListener(listener);
  return () => {
    chrome.runtime.onMessage.removeListener(listener);
    if (refreshTimer !== null) clearTimeout(refreshTimer);
  };
}
