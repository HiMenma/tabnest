/**
 * IndexedDB plumbing.
 *
 * Two rules keep this honest:
 *   1. Sequence is fixed. Awaiting a promise that is not backed by a request of
 *      the current transaction (a digest, a fetch, a timer) lets the transaction
 *      auto-commit, and the next request throws TransactionInactiveError. Work
 *      that needs such a promise must happen *before* opening the transaction.
 *   2. The schema only changes by bumping DB_VERSION and adding an upgrade step.
 */
import { DEFAULT_SETTINGS, type Group, QUICK_LIST_ID, ROOT_ID, TRASH_ID } from "./model";

export const DB_NAME = "tabnest";
export const DB_VERSION = 1;

export type StoreName = "node" | "meta" | "change" | "tombstone";

export interface MetaRow {
  key: string;
  value: unknown;
}

export interface Stores {
  node: IDBObjectStore;
  meta: IDBObjectStore;
  change: IDBObjectStore;
  tombstone: IDBObjectStore;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function seed(transaction: IDBTransaction): void {
  const now = Date.now();
  const nodes = transaction.objectStore("node");
  const meta = transaction.objectStore("meta");

  const group = (id: string, groupType: Group["groupType"]): Group => ({
    id,
    kind: "group",
    groupType,
    children: [],
    parents: [],
    createdAt: now,
    updatedAt: now,
  });

  nodes.put(group(ROOT_ID, "root"));
  nodes.put(group(QUICK_LIST_ID, "quickList"));
  nodes.put(group(TRASH_ID, "folder"));

  meta.put({ key: "installId", value: crypto.randomUUID() });
  meta.put({ key: "createdAt", value: now });
  meta.put({ key: "settings", value: DEFAULT_SETTINGS });
  meta.put({ key: "quarantinedUrls", value: [] as string[] });
  meta.put({ key: "schemaVersion", value: DB_VERSION });
}

function upgrade(db: IDBDatabase, oldVersion: number): void {
  if (oldVersion < 1) {
    const node = db.createObjectStore("node", { keyPath: "id" });
    node.createIndex("kind", "kind");
    node.createIndex("groupType", "groupType");
    node.createIndex("updatedAt", "updatedAt");

    db.createObjectStore("meta", { keyPath: "key" });
    db.createObjectStore("change", { keyPath: "seq", autoIncrement: true });
    db.createObjectStore("tombstone", { keyPath: "id" });

    seed(node.transaction);
  }
}

export function openDb(): Promise<IDBDatabase> {
  dbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => upgrade(request.result, event.oldVersion);
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    request.onerror = () => reject(request.error ?? new Error("indexedDB.open failed"));
    request.onblocked = () => reject(new Error("indexedDB.open blocked by another connection"));
  });
  return dbPromise;
}

export function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IDBRequest failed"));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("transaction failed"));
    transaction.onabort = () => reject(transaction.error ?? new Error("transaction aborted"));
  });
}

/**
 * Runs `body` inside one transaction. `body` must not await anything that is not
 * backed by a request of this transaction.
 */
export async function tx<T>(
  names: StoreName[],
  mode: IDBTransactionMode,
  body: (stores: Stores, transaction: IDBTransaction) => T | Promise<T>,
): Promise<T> {
  const db = await openDb();
  const transaction = db.transaction(names, mode);

  // Stores are resolved lazily: a transaction only exposes the stores it was
  // created with, so touching an unlisted one would throw a NotFoundError.
  const cache = new Map<StoreName, IDBObjectStore>();
  const stores = new Proxy({} as Stores, {
    get(_target, property) {
      const name = property as StoreName;
      if (!names.includes(name)) {
        throw new Error(`store "${String(property)}" is not part of this transaction`);
      }
      let store = cache.get(name);
      if (!store) {
        store = transaction.objectStore(name);
        cache.set(name, store);
      }
      return store;
    },
  });

  const done = transactionDone(transaction);
  let result: T;
  try {
    result = await body(stores, transaction);
  } catch (error) {
    try {
      transaction.abort();
    } catch {
      // already finished
    }
    await done.catch(() => undefined);
    throw error;
  }
  await done;
  return result;
}

/** Reads every row of a store. Read-only; no awaits inside. */
export async function readAll<T>(store: StoreName): Promise<T[]> {
  return tx([store], "readonly", (stores) =>
    requestToPromise(stores[store].getAll() as IDBRequest<T[]>),
  );
}

export async function readOne<T>(store: StoreName, key: IDBValidKey): Promise<T | undefined> {
  return tx([store], "readonly", (stores) =>
    requestToPromise(stores[store].get(key) as IDBRequest<T | undefined>),
  );
}

/** Test/repair helper: drops the in-memory connection so the next call reopens. */
export function resetDbConnectionForTests(): void {
  dbPromise = null;
}
