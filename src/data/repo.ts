/**
 * The repository: the only module that writes the library.
 *
 * Everything that mutates state goes through here so that
 *   - the tree invariants hold after every transaction,
 *   - a sync journal entry is written in the same transaction, and
 *   - pages never have to guess what changed.
 *
 * Transaction rule (see idb.ts): all hashing and URL work happens *before* a
 * write transaction opens. Inside a transaction only request-backed promises are
 * awaited.
 */
import { requestToPromise, type Stores, tx } from "./idb";
import {
  type ChangeOp,
  DEFAULT_SETTINGS,
  type Group,
  type GroupType,
  type Id,
  type LibrarySnapshot,
  type LibraryStats,
  type Node,
  QUICK_LIST_ID,
  ROOT_ID,
  type Settings,
  SYSTEM_GROUP_IDS,
  type TabItem,
  type Tombstone,
  TRASH_ID,
} from "./model";
import { canonicalizeUrl, hostOf, normalizeTitle, urlId } from "./url";

// ---------------------------------------------------------------------------
// journal
// ---------------------------------------------------------------------------

let journalEnabled = false;

/** Enabled by the sync engine once the user has configured a backend. */
export function setJournalEnabled(value: boolean): void {
  journalEnabled = value;
}

export function isJournalEnabled(): boolean {
  return journalEnabled;
}

function pushChange(stores: Stores, op: ChangeOp): void {
  if (!journalEnabled) return;
  stores.change.add({ at: Date.now(), op });
}

// ---------------------------------------------------------------------------
// low-level helpers (all request-backed, safe inside a transaction)
// ---------------------------------------------------------------------------

function readNode(stores: Stores, id: Id): Promise<Node | undefined> {
  return requestToPromise(stores.node.get(id) as IDBRequest<Node | undefined>);
}

function readAllNodes(stores: Stores): Promise<Node[]> {
  return requestToPromise(stores.node.getAll() as unknown as IDBRequest<Node[]>);
}

function writeNode(stores: Stores, node: Node): void {
  stores.node.put(node);
}

async function metaGet<T>(stores: Stores, key: string): Promise<T | undefined> {
  const row = await requestToPromise(stores.meta.get(key) as IDBRequest<{ key: string; value: T }>);
  return row?.value;
}

function metaPut(stores: Stores, key: string, value: unknown): void {
  stores.meta.put({ key, value });
}

function touchGroup(group: Group, at: number): void {
  group.updatedAt = at;
}

// ---------------------------------------------------------------------------
// settings and meta
// ---------------------------------------------------------------------------

export async function getSettings(): Promise<Settings> {
  return tx(["meta"], "readonly", async (stores) => {
    const stored = await metaGet<Partial<Settings>>(stores, "settings");
    return { ...DEFAULT_SETTINGS, ...(stored ?? {}) };
  });
}

export async function patchSettings(patch: Partial<Settings>): Promise<Settings> {
  return tx(["meta", "change"], "readwrite", async (stores) => {
    const stored = await metaGet<Partial<Settings>>(stores, "settings");
    const next: Settings = { ...DEFAULT_SETTINGS, ...(stored ?? {}), ...patch };
    const at = Date.now();
    metaPut(stores, "settings", next);

    // Remember when each key changed so a remote merge can order two edits of the
    // same setting without a vector clock.
    const madeAts = (await metaGet<Record<string, number>>(stores, "settingsMadeAts")) ?? {};
    for (const key of Object.keys(patch)) madeAts[key] = at;
    metaPut(stores, "settingsMadeAts", madeAts);

    pushChange(stores, { op: "settings", patch: patch as Record<string, unknown>, at });
    return next;
  });
}

export async function getMeta<T>(key: string): Promise<T | undefined> {
  return tx(["meta"], "readonly", (stores) => metaGet<T>(stores, key));
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  await tx(["meta"], "readwrite", (stores) => {
    metaPut(stores, key, value);
  });
}

// ---------------------------------------------------------------------------
// snapshot
// ---------------------------------------------------------------------------

export function computeStats(nodes: Node[], quarantined = 0): LibraryStats {
  let tabs = 0;
  let groups = 0;
  let folders = 0;
  for (const node of nodes) {
    if (node.kind === "tab") {
      tabs += 1;
      continue;
    }
    if (node.kind !== "group") continue;
    if (SYSTEM_GROUP_IDS.includes(node.id)) continue;
    groups += 1;
    if (node.groupType === "folder") folders += 1;
  }
  return { tabs, groups, folders, total: tabs + groups, quarantined };
}

export async function loadSnapshot(): Promise<LibrarySnapshot> {
  return tx(["node", "meta"], "readonly", async (stores) => {
    const nodes = await readAllNodes(stores);
    const stored = await metaGet<Partial<Settings>>(stores, "settings");
    const quarantined = await metaGet<string[]>(stores, "quarantinedUrls");
    return {
      nodes,
      settings: { ...DEFAULT_SETTINGS, ...(stored ?? {}) },
      stats: computeStats(nodes, quarantined?.length ?? 0),
    };
  });
}

export async function listNodes(): Promise<Node[]> {
  return tx(["node"], "readonly", (stores) => readAllNodes(stores));
}

export async function getNode(id: Id): Promise<Node | undefined> {
  return tx(["node"], "readonly", (stores) => readNode(stores, id));
}

// ---------------------------------------------------------------------------
// parking
// ---------------------------------------------------------------------------

export interface PreparedTab {
  id: Id;
  url: string;
  title: string;
  host: string;
}

/**
 * Canonicalises, deduplicates within the batch and hashes. All the async work
 * happens here so the commit can stay inside one transaction.
 */
export async function prepareTabs(
  input: readonly { url: string; title?: string | undefined }[],
): Promise<PreparedTab[]> {
  const seen = new Set<string>();
  const prepared: PreparedTab[] = [];
  for (const item of input) {
    const canonical = canonicalizeUrl(item.url);
    if (!canonical) continue;
    if (seen.has(canonical)) continue;
    seen.add(canonical);
    prepared.push({
      id: await urlId(canonical),
      url: item.url,
      title: normalizeTitle(item.title, item.url),
      host: hostOf(item.url),
    });
  }
  return prepared;
}

export interface CommitParkOptions {
  targetParentId?: Id;
  /** When set, a new group with this label is created and receives the tabs. */
  groupLabel?: string;
  groupType?: GroupType;
  alreadyParked?: "skip" | "duplicate";
}

export interface CommitParkResult {
  added: number;
  skipped: number;
  groupId: Id;
}

export async function commitPark(
  prepared: readonly PreparedTab[],
  options: CommitParkOptions = {},
): Promise<CommitParkResult> {
  const now = Date.now();
  const targetId = options.targetParentId ?? ROOT_ID;
  const policy = options.alreadyParked ?? "skip";

  return tx(["node", "change"], "readwrite", async (stores) => {
    const parent = await readNode(stores, targetId);
    if (parent?.kind !== "group") throw new Error(`park target ${targetId} is not a group`);

    let receiver: Group = parent;
    let createdGroup: Group | null = null;

    // The group is only created once the first tab is actually accepted, so a
    // park that skips everything does not leave an empty shell behind.
    const ensureReceiver = (): Group => {
      if (createdGroup) return createdGroup;
      if (!options.groupLabel) return parent;
      const group: Group = {
        id: crypto.randomUUID(),
        kind: "group",
        groupType: options.groupType ?? "window",
        label: options.groupLabel,
        children: [],
        parents: [targetId],
        createdAt: now,
        updatedAt: now,
      };
      createdGroup = group;
      receiver = group;
      writeNode(stores, group);
      parent.children.push(group.id);
      touchGroup(parent, now);
      writeNode(stores, parent);
      pushChange(stores, { op: "upsert", node: group });
      return group;
    };

    let added = 0;
    let skipped = 0;

    for (const item of prepared) {
      const existing = await readNode(stores, item.id);

      if (existing && policy === "skip" && existing.parents.length > 0) {
        skipped += 1;
        continue;
      }

      const group = ensureReceiver();
      const record: TabItem =
        existing && existing.kind === "tab"
          ? { ...existing, updatedAt: now }
          : {
              id: item.id,
              kind: "tab",
              url: item.url,
              title: item.title,
              host: item.host,
              parents: [],
              createdAt: now,
              updatedAt: now,
            };

      if (!record.parents.includes(group.id)) record.parents.push(group.id);
      if (!group.children.includes(record.id)) group.children.push(record.id);

      writeNode(stores, record);
      pushChange(stores, { op: "upsert", node: record });
      added += 1;
    }

    touchGroup(receiver, now);
    writeNode(stores, receiver);
    pushChange(stores, { op: "reorder", id: receiver.id, children: receiver.children, at: now });
    if (createdGroup) touchGroup(parent, now);

    return { added, skipped, groupId: receiver.id };
  });
}

// ---------------------------------------------------------------------------
// groups
// ---------------------------------------------------------------------------

export async function createGroup(
  label: string,
  parentId: Id = ROOT_ID,
  groupType: GroupType = "folder",
): Promise<Id> {
  const now = Date.now();
  const id = crypto.randomUUID();
  await tx(["node", "change"], "readwrite", async (stores) => {
    const parent = await readNode(stores, parentId);
    if (parent?.kind !== "group") throw new Error(`parent ${parentId} is not a group`);
    const group: Group = {
      id,
      kind: "group",
      groupType,
      label,
      children: [],
      parents: [parentId],
      createdAt: now,
      updatedAt: now,
    };
    writeNode(stores, group);
    parent.children.push(id);
    touchGroup(parent, now);
    writeNode(stores, parent);
    pushChange(stores, { op: "upsert", node: group });
    pushChange(stores, { op: "reorder", id: parentId, children: parent.children, at: now });
  });
  return id;
}

export async function updateGroup(
  id: Id,
  patch: { label?: string; color?: string },
): Promise<void> {
  const now = Date.now();
  await tx(["node", "change"], "readwrite", async (stores) => {
    const node = await readNode(stores, id);
    if (node?.kind !== "group") throw new Error(`group ${id} not found`);
    if (patch.label !== undefined) node.label = patch.label;
    if (patch.color !== undefined) node.color = patch.color;
    node.updatedAt = now;
    writeNode(stores, node);
    pushChange(stores, { op: "upsert", node });
  });
}

// ---------------------------------------------------------------------------
// tabs
// ---------------------------------------------------------------------------

export interface TabPatch {
  title?: string;
  notes?: string;
  rating?: TabItem["rating"];
  archivedAt?: number | null;
}

export async function updateTab(id: Id, patch: TabPatch): Promise<void> {
  const now = Date.now();
  await tx(["node", "change"], "readwrite", async (stores) => {
    const node = await readNode(stores, id);
    if (node?.kind !== "tab") throw new Error(`tab ${id} not found`);
    if (patch.title !== undefined) node.title = patch.title;
    if (patch.notes !== undefined) node.notes = patch.notes;
    if (patch.rating !== undefined) node.rating = patch.rating;
    if (patch.archivedAt !== undefined) {
      if (patch.archivedAt === null) delete node.archivedAt;
      else node.archivedAt = patch.archivedAt;
    }
    node.updatedAt = now;
    writeNode(stores, node);
    pushChange(stores, { op: "upsert", node });
  });
}

/**
 * Changing a URL changes the record's identity, so this creates the new record,
 * swaps it into every parent's child list and tombstones the old one.
 */
export async function updateTabUrl(id: Id, rawUrl: string): Promise<Id> {
  const canonical = canonicalizeUrl(rawUrl);
  if (!canonical) throw new Error("that URL cannot be stored");
  const nextId = await urlId(canonical);
  if (nextId === id) return id;

  const now = Date.now();
  await tx(["node", "change", "tombstone"], "readwrite", async (stores) => {
    const node = await readNode(stores, id);
    if (node?.kind !== "tab") throw new Error(`tab ${id} not found`);

    const replacement: TabItem = {
      ...node,
      id: nextId,
      url: rawUrl,
      host: hostOf(rawUrl),
      updatedAt: now,
    };
    writeNode(stores, replacement);

    for (const parentId of node.parents) {
      const parent = await readNode(stores, parentId);
      if (parent?.kind !== "group") continue;
      parent.children = parent.children.map((childId) => (childId === id ? nextId : childId));
      touchGroup(parent, now);
      writeNode(stores, parent);
      pushChange(stores, { op: "reorder", id: parentId, children: parent.children, at: now });
    }

    stores.node.delete(id);
    const tomb: Tombstone = { id, deletedAt: now, reason: "deleted" };
    stores.tombstone.put(tomb);
    pushChange(stores, { op: "delete", id, at: now });
    pushChange(stores, { op: "upsert", node: replacement });
  });
  return nextId;
}

// ---------------------------------------------------------------------------
// moving
// ---------------------------------------------------------------------------

export async function moveNodes(
  ids: readonly Id[],
  targetParentId: Id,
  index?: number,
): Promise<void> {
  const now = Date.now();
  await tx(["node", "change"], "readwrite", async (stores) => {
    const target = await readNode(stores, targetParentId);
    if (target?.kind !== "group") throw new Error(`target ${targetParentId} is not a group`);

    const touchedParents = new Set<Id>();
    let insertAt = index ?? target.children.length;

    for (const id of ids) {
      if (id === targetParentId) continue;
      const node = await readNode(stores, id);
      if (!node) continue;

      // A group cannot be moved inside itself or one of its descendants.
      if (node.kind === "group" && (await containsNode(stores, node.id, targetParentId))) continue;

      for (const parentId of node.parents) {
        if (parentId === targetParentId) continue;
        const parent = await readNode(stores, parentId);
        if (parent?.kind !== "group") continue;
        parent.children = parent.children.filter((childId) => childId !== id);
        touchGroup(parent, now);
        writeNode(stores, parent);
        touchedParents.add(parentId);
      }

      node.parents = [targetParentId];
      node.updatedAt = now;
      writeNode(stores, node);
      pushChange(stores, { op: "upsert", node });

      target.children = target.children.filter((childId) => childId !== id);
      const clamped = Math.max(0, Math.min(insertAt, target.children.length));
      target.children.splice(clamped, 0, id);
      insertAt = clamped + 1;
    }

    touchGroup(target, now);
    writeNode(stores, target);
    touchedParents.add(target.id);

    for (const parentId of touchedParents) {
      const parent = await readNode(stores, parentId);
      if (parent && parent.kind === "group") {
        pushChange(stores, { op: "reorder", id: parentId, children: parent.children, at: now });
      }
    }
  });
}

/** True when `targetId` is `rootId` itself or sits somewhere inside its subtree. */
async function containsNode(stores: Stores, rootId: Id, targetId: Id): Promise<boolean> {
  if (rootId === targetId) return true;
  const root = await readNode(stores, rootId);
  if (root?.kind !== "group") return false;
  for (const childId of root.children) {
    if (await containsNode(stores, childId, targetId)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// deleting and restoring
// ---------------------------------------------------------------------------

export async function deleteNodes(ids: readonly Id[], mode: "trash" | "purge"): Promise<number> {
  const now = Date.now();
  return tx(["node", "change", "tombstone"], "readwrite", async (stores) => {
    let removed = 0;

    for (const id of ids) {
      if (SYSTEM_GROUP_IDS.includes(id)) continue;
      const node = await readNode(stores, id);
      if (!node) continue;

      if (mode === "trash") {
        if (node.parents.length === 1 && node.parents[0] === TRASH_ID) continue;
        for (const parentId of node.parents) {
          const parent = await readNode(stores, parentId);
          if (parent?.kind !== "group") continue;
          parent.children = parent.children.filter((childId) => childId !== id);
          touchGroup(parent, now);
          writeNode(stores, parent);
          pushChange(stores, { op: "reorder", id: parentId, children: parent.children, at: now });
        }
        const trash = await readNode(stores, TRASH_ID);
        if (trash && trash.kind === "group" && !trash.children.includes(id)) {
          trash.children.push(id);
          touchGroup(trash, now);
          writeNode(stores, trash);
          pushChange(stores, { op: "reorder", id: TRASH_ID, children: trash.children, at: now });
        }
        node.parents = [TRASH_ID];
        node.updatedAt = now;
        writeNode(stores, node);
        pushChange(stores, { op: "upsert", node });
        removed += 1;
        continue;
      }

      // purge: remove the record and, for a group, everything inside it
      const stack: Id[] = [id];
      const seen = new Set<Id>();
      while (stack.length > 0) {
        const current = stack.pop();
        if (current === undefined || seen.has(current)) continue;
        seen.add(current);
        const victim = await readNode(stores, current);
        if (!victim) continue;
        if (victim.kind === "group") stack.push(...victim.children);
        stores.node.delete(current);
        stores.tombstone.put({ id: current, deletedAt: now, reason: "purged" } satisfies Tombstone);
        pushChange(stores, { op: "delete", id: current, at: now });
        removed += 1;
      }

      for (const parentId of node.parents) {
        const parent = await readNode(stores, parentId);
        if (parent?.kind !== "group") continue;
        parent.children = parent.children.filter((childId) => childId !== id);
        touchGroup(parent, now);
        writeNode(stores, parent);
        pushChange(stores, { op: "reorder", id: parentId, children: parent.children, at: now });
      }
    }

    return removed;
  });
}

export async function restoreNodes(
  ids: readonly Id[],
  targetParentId: Id = ROOT_ID,
): Promise<number> {
  const now = Date.now();
  return tx(["node", "change"], "readwrite", async (stores) => {
    const target = await readNode(stores, targetParentId);
    if (target?.kind !== "group") throw new Error(`target ${targetParentId} is not a group`);

    let restored = 0;
    for (const id of ids) {
      const node = await readNode(stores, id);
      if (!node) continue;
      if (!node.parents.includes(TRASH_ID)) continue;

      const trash = await readNode(stores, TRASH_ID);
      if (trash && trash.kind === "group") {
        trash.children = trash.children.filter((childId) => childId !== id);
        touchGroup(trash, now);
        writeNode(stores, trash);
        pushChange(stores, { op: "reorder", id: TRASH_ID, children: trash.children, at: now });
      }

      node.parents = [targetParentId];
      node.updatedAt = now;
      writeNode(stores, node);
      if (!target.children.includes(id)) target.children.push(id);
      pushChange(stores, { op: "upsert", node });
      restored += 1;
    }

    touchGroup(target, now);
    writeNode(stores, target);
    pushChange(stores, { op: "reorder", id: targetParentId, children: target.children, at: now });
    return restored;
  });
}

export async function setQuickList(id: Id, member: boolean): Promise<void> {
  const now = Date.now();
  await tx(["node", "change"], "readwrite", async (stores) => {
    const node = await readNode(stores, id);
    if (!node) return;
    const quick = await readNode(stores, QUICK_LIST_ID);
    if (quick?.kind !== "group") return;

    if (member) {
      if (!node.parents.includes(QUICK_LIST_ID)) node.parents.push(QUICK_LIST_ID);
      if (!quick.children.includes(id)) quick.children.push(id);
    } else {
      node.parents = node.parents.filter((parentId) => parentId !== QUICK_LIST_ID);
      quick.children = quick.children.filter((childId) => childId !== id);
    }
    node.updatedAt = now;
    touchGroup(quick, now);
    writeNode(stores, node);
    writeNode(stores, quick);
    pushChange(stores, { op: "upsert", node });
    pushChange(stores, { op: "reorder", id: QUICK_LIST_ID, children: quick.children, at: now });
  });
}

// ---------------------------------------------------------------------------
// quarantine
// ---------------------------------------------------------------------------

export async function quarantineUrls(urls: readonly string[]): Promise<void> {
  if (urls.length === 0) return;
  await tx(["meta"], "readwrite", async (stores) => {
    const existing = (await metaGet<string[]>(stores, "quarantinedUrls")) ?? [];
    const merged = [...existing, ...urls].slice(-200);
    metaPut(stores, "quarantinedUrls", merged);
  });
}

export async function clearQuarantine(): Promise<void> {
  await tx(["meta"], "readwrite", (stores) => {
    metaPut(stores, "quarantinedUrls", []);
  });
}

// ---------------------------------------------------------------------------
// repair
// ---------------------------------------------------------------------------

export interface RepairReport {
  danglingChildren: number;
  missingBacklinks: number;
  duplicateChildren: number;
  orphanedNodes: number;
  /** Children a node claims as parents but the group did not list. */
  missingChildren: number;
}

/**
 * Re-establishes the invariants. Called after applying a remote batch, where a
 * partially ordered stream can legitimately produce a temporary inconsistency.
 */
export async function repair(): Promise<RepairReport> {
  const now = Date.now();
  return tx(["node", "change"], "readwrite", async (stores) => {
    const nodes = await readAllNodes(stores);
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const patched = new Set<Id>();
    const report: RepairReport = {
      danglingChildren: 0,
      missingBacklinks: 0,
      duplicateChildren: 0,
      orphanedNodes: 0,
      missingChildren: 0,
    };

    for (const node of nodes) {
      if (node.kind !== "group") continue;
      const seen = new Set<Id>();
      const kept: Id[] = [];
      for (const childId of node.children) {
        const child = byId.get(childId);
        if (!child) {
          report.danglingChildren += 1;
          continue;
        }
        if (seen.has(childId)) {
          report.duplicateChildren += 1;
          continue;
        }
        seen.add(childId);
        kept.push(childId);
        if (!child.parents.includes(node.id)) {
          child.parents = [...child.parents, node.id];
          child.updatedAt = now;
          patched.add(childId);
          report.missingBacklinks += 1;
        }
      }
      if (kept.length !== node.children.length) {
        node.children = kept;
        node.updatedAt = now;
        writeNode(stores, node);
        pushChange(stores, { op: "reorder", id: node.id, children: node.children, at: now });
      }
    }

    // Two devices adding a child to the same group both survive: the record says
    // which groups it belongs to, so a group that does not list it gains it here.
    for (const node of nodes) {
      for (const parentId of node.parents) {
        const parent = byId.get(parentId);
        if (parent?.kind !== "group") continue;
        if (parent.children.includes(node.id)) continue;
        parent.children.push(node.id);
        parent.updatedAt = Math.max(parent.updatedAt, node.updatedAt);
        patched.add(parentId);
        report.missingChildren += 1;
      }
    }

    // Drop parent references that point at records which no longer exist.
    for (const node of nodes) {
      const parents = node.parents.filter((parentId) => byId.has(parentId));
      if (parents.length !== node.parents.length) {
        node.parents = parents;
        node.updatedAt = now;
        patched.add(node.id);
        if (parents.length === 0 && node.kind === "tab") report.orphanedNodes += 1;
      }
    }

    for (const id of patched) {
      const node = byId.get(id);
      if (node) {
        writeNode(stores, node);
        pushChange(stores, { op: "upsert", node });
      }
    }

    return report;
  });
}

export async function listTombstones(): Promise<Tombstone[]> {
  return tx(["tombstone"], "readonly", (stores) =>
    requestToPromise(stores.tombstone.getAll() as unknown as IDBRequest<Tombstone[]>),
  );
}

export async function pruneTombstones(olderThanMs: number): Promise<number> {
  const cutoff = Date.now() - olderThanMs;
  return tx(["tombstone"], "readwrite", async (stores) => {
    const all = await requestToPromise(
      stores.tombstone.getAll() as unknown as IDBRequest<Tombstone[]>,
    );
    let removed = 0;
    for (const tomb of all) {
      if (tomb.deletedAt < cutoff) {
        stores.tombstone.delete(tomb.id);
        removed += 1;
      }
    }
    return removed;
  });
}

// ---------------------------------------------------------------------------
// sync support
// ---------------------------------------------------------------------------

export interface QueuedChange {
  seq: number;
  at: number;
  op: ChangeOp;
}

/** Reads pending journal entries in sequence order. */
export async function listQueuedChanges(limit = 500): Promise<QueuedChange[]> {
  return tx(["change"], "readonly", async (stores) => {
    const all = await requestToPromise(
      stores.change.getAll() as unknown as IDBRequest<QueuedChange[]>,
    );
    return all
      .filter((row): row is QueuedChange => typeof row.seq === "number")
      .sort((a, b) => a.seq - b.seq)
      .slice(0, limit);
  });
}

export async function countQueuedChanges(): Promise<number> {
  return tx(["change"], "readonly", (stores) =>
    requestToPromise(stores.change.count() as IDBRequest<number>),
  );
}

export async function deleteChanges(seqs: readonly number[]): Promise<void> {
  if (seqs.length === 0) return;
  await tx(["change"], "readwrite", (stores) => {
    for (const seq of seqs) stores.change.delete(seq);
  });
}

export interface ApplyResult {
  applied: number;
  skipped: number;
}

/**
 * Applies a remote batch with last-write-wins per record.
 *
 * No journal entry is written: these changes came from elsewhere, and echoing
 * them would make two devices fight forever.
 */
export async function applyRemoteOps(ops: readonly ChangeOp[]): Promise<ApplyResult> {
  const result: ApplyResult = { applied: 0, skipped: 0 };

  await tx(["node", "tombstone", "meta"], "readwrite", async (stores) => {
    for (const op of ops) {
      if (op.op === "upsert") {
        const incoming = op.node;
        const existing = await readNode(stores, incoming.id);
        if (existing) {
          if (existing.updatedAt > incoming.updatedAt) {
            result.skipped += 1;
            continue;
          }
          // Equal timestamps must still converge: both devices compare the two
          // serialisations and keep the same one, so they cannot swap forever.
          if (
            existing.updatedAt === incoming.updatedAt &&
            JSON.stringify(existing) >= JSON.stringify(incoming)
          ) {
            result.skipped += 1;
            continue;
          }
        }
        const tomb = await requestToPromise(
          stores.tombstone.get(incoming.id) as IDBRequest<Tombstone | undefined>,
        );
        if (tomb && tomb.deletedAt >= incoming.updatedAt) {
          result.skipped += 1;
          continue;
        }
        writeNode(stores, incoming);
        result.applied += 1;
        continue;
      }

      if (op.op === "delete") {
        const existing = await readNode(stores, op.id);
        if (!existing) {
          stores.tombstone.put({
            id: op.id,
            deletedAt: op.at,
            reason: "deleted",
          } satisfies Tombstone);
          result.skipped += 1;
          continue;
        }
        if (existing.updatedAt > op.at) {
          result.skipped += 1;
          continue;
        }
        stores.node.delete(op.id);
        stores.tombstone.put({
          id: op.id,
          deletedAt: op.at,
          reason: "deleted",
        } satisfies Tombstone);
        result.applied += 1;
        continue;
      }

      if (op.op === "reorder") {
        const existing = await readNode(stores, op.id);
        if (existing?.kind !== "group" || existing.updatedAt > op.at) {
          result.skipped += 1;
          continue;
        }
        existing.children = [...op.children];
        existing.updatedAt = op.at;
        writeNode(stores, existing);
        result.applied += 1;
        continue;
      }

      // settings: per-key last-write-wins
      const madeAts = (await metaGet<Record<string, number>>(stores, "settingsMadeAts")) ?? {};
      const stored = (await metaGet<Partial<Settings>>(stores, "settings")) ?? {};
      let changed = false;
      for (const [key, value] of Object.entries(op.patch)) {
        const previous = madeAts[key] ?? 0;
        if (op.at <= previous) continue;
        (stored as Record<string, unknown>)[key] = value;
        madeAts[key] = op.at;
        changed = true;
      }
      if (changed) {
        metaPut(stores, "settings", { ...DEFAULT_SETTINGS, ...stored });
        metaPut(stores, "settingsMadeAts", madeAts);
        result.applied += 1;
      } else {
        result.skipped += 1;
      }
    }
  });

  return result;
}

/** Every record, for the snapshot a compacted chunk carries. */
export async function allNodes(): Promise<Node[]> {
  return tx(["node"], "readonly", (stores) => readAllNodes(stores));
}

/** Records the local timestamp of a settings change so remote merges can order it. */
export async function markSettingsChanged(patch: Partial<Settings>): Promise<void> {
  await tx(["meta"], "readwrite", async (stores) => {
    const madeAts = (await metaGet<Record<string, number>>(stores, "settingsMadeAts")) ?? {};
    const at = Date.now();
    for (const key of Object.keys(patch)) madeAts[key] = at;
    metaPut(stores, "settingsMadeAts", madeAts);
  });
}
