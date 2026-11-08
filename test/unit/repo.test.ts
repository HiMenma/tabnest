import { beforeEach, describe, expect, it } from "vitest";
import { DB_NAME, resetDbConnectionForTests } from "../../src/data/idb";
import {
  type Group,
  type Node,
  QUICK_LIST_ID,
  ROOT_ID,
  type TabItem,
  TRASH_ID,
} from "../../src/data/model";
import {
  commitPark,
  createGroup,
  deleteNodes,
  getNode,
  getSettings,
  isJournalEnabled,
  listNodes,
  listTombstones,
  loadSnapshot,
  moveNodes,
  prepareTabs,
  pruneTombstones,
  repair,
  restoreNodes,
  setJournalEnabled,
  setQuickList,
  updateGroup,
  updateTab,
  updateTabUrl,
} from "../../src/data/repo";

async function freshDb(): Promise<void> {
  resetDbConnectionForTests();
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => resolve();
  });
}

async function parkUrls(urls: string[], groupLabel?: string): Promise<string> {
  const prepared = await prepareTabs(urls.map((url) => ({ url })));
  const result = await commitPark(prepared, groupLabel ? { groupLabel } : {});
  return result.groupId;
}

function byId(nodes: Node[]): Map<string, Node> {
  return new Map(nodes.map((node) => [node.id, node]));
}

function group(nodes: Map<string, Node>, id: string): Group {
  const node = nodes.get(id);
  if (node?.kind !== "group") throw new Error(`${id} is not a group`);
  return node;
}

function tab(nodes: Map<string, Node>, id: string): TabItem {
  const node = nodes.get(id);
  if (node?.kind !== "tab") throw new Error(`${id} is not a tab`);
  return node;
}

beforeEach(async () => {
  setJournalEnabled(false);
  await freshDb();
});

describe("seeding", () => {
  it("creates the three system groups on first open", async () => {
    const snapshot = await loadSnapshot();
    const nodes = byId(snapshot.nodes);
    expect(nodes.size).toBe(3);
    expect(group(nodes, ROOT_ID).groupType).toBe("root");
    expect(group(nodes, QUICK_LIST_ID).groupType).toBe("quickList");
    expect(group(nodes, TRASH_ID).groupType).toBe("folder");
  });

  it("ships the default settings", async () => {
    const settings = await getSettings();
    expect(settings.pinned).toBe("ignore");
    expect(settings.alreadyParked).toBe("skip");
    expect(settings.closeAfter).toBe("window");
  });
});

describe("parking", () => {
  it("writes tabs into a new group and keeps both sides consistent", async () => {
    const before = (await listNodes()).length;
    const groupId = await parkUrls(["https://a.example/1", "https://b.example/2"], "Two tabs");

    const nodes = byId(await listNodes());
    expect(nodes.size).toBe(before + 3); // group + two tabs

    const created = group(nodes, groupId);
    expect(created.label).toBe("Two tabs");
    expect(created.groupType).toBe("window");
    expect(created.parents).toEqual([ROOT_ID]);
    expect(created.children).toHaveLength(2);
    expect(group(nodes, ROOT_ID).children).toContain(groupId);

    for (const childId of created.children) {
      expect(tab(nodes, childId).parents).toEqual([groupId]);
    }
  });

  it("deduplicates within one batch", async () => {
    const groupId = await parkUrls([
      "https://example.com/a",
      "https://example.com/a?utm_source=newsletter",
      "https://example.com/a#anchor",
    ]);
    expect(group(byId(await listNodes()), groupId).children).toHaveLength(1);
  });

  it("skips a URL that is already stored", async () => {
    await parkUrls(["https://example.com/a"]);
    const prepared = await prepareTabs([{ url: "https://example.com/a" }]);
    const result = await commitPark(prepared, {});
    expect(result.added).toBe(0);
    expect(result.skipped).toBe(1);
  });

  it("attaches an existing URL to a second group in duplicate mode", async () => {
    const first = await parkUrls(["https://example.com/a"], "first");
    const prepared = await prepareTabs([{ url: "https://example.com/a" }]);
    const second = await commitPark(prepared, {
      groupLabel: "second",
      alreadyParked: "duplicate",
    });

    expect(second.added).toBe(1);
    const nodes = byId(await listNodes());
    const [tabId] = group(nodes, second.groupId).children;
    expect(tab(nodes, tabId as string).parents).toEqual([first, second.groupId]);
  });

  it("does not create an empty group when everything is skipped", async () => {
    await parkUrls(["https://example.com/a"]);
    const sizeBefore = (await listNodes()).length;
    const prepared = await prepareTabs([{ url: "https://example.com/a" }]);
    await commitPark(prepared, { groupLabel: "should not exist" });
    expect((await listNodes()).length).toBe(sizeBefore);
  });

  it("refuses to park into a record that is not a group", async () => {
    const groupId = await parkUrls(["https://example.com/a"]);
    const nodes = byId(await listNodes());
    const tabId = group(nodes, groupId).children[0] as string;
    const prepared = await prepareTabs([{ url: "https://example.com/b" }]);
    await expect(commitPark(prepared, { targetParentId: tabId })).rejects.toThrow(/not a group/);
  });
});

describe("moving", () => {
  it("moves a node between groups and fixes both child lists", async () => {
    const source = await parkUrls(["https://example.com/a", "https://example.com/b"], "source");
    const target = await createGroup("target");
    const nodes = byId(await listNodes());
    const tabId = group(nodes, source).children[0] as string;

    await moveNodes([tabId], target);

    const after = byId(await listNodes());
    expect(group(after, source).children).not.toContain(tabId);
    expect(group(after, target).children).toContain(tabId);
    expect(tab(after, tabId).parents).toEqual([target]);
  });

  it("inserts at the requested index", async () => {
    const source = await parkUrls(["https://example.com/a"], "source");
    const target = await parkUrls(["https://example.com/b", "https://example.com/c"], "target");
    const nodes = byId(await listNodes());
    const moving = group(nodes, source).children[0] as string;

    await moveNodes([moving], target, 1);

    expect(group(byId(await listNodes()), target).children[1]).toBe(moving);
  });

  it("refuses to move a group into its own subtree", async () => {
    const outer = await createGroup("outer");
    const inner = await createGroup("inner", outer);
    await moveNodes([outer], inner);

    const nodes = byId(await listNodes());
    expect(group(nodes, outer).parents).toEqual([ROOT_ID]);
    expect(group(nodes, inner).children).toEqual([]);
  });
});

describe("deleting", () => {
  it("moves to the trash without losing the record", async () => {
    const groupId = await parkUrls(["https://example.com/a"], "doomed");
    await deleteNodes([groupId], "trash");

    const nodes = byId(await listNodes());
    expect(nodes.has(groupId)).toBe(true);
    expect(group(nodes, groupId).parents).toEqual([TRASH_ID]);
    expect(group(nodes, ROOT_ID).children).not.toContain(groupId);
    expect(group(nodes, TRASH_ID).children).toContain(groupId);
  });

  it("restores from the trash", async () => {
    const groupId = await parkUrls(["https://example.com/a"], "back soon");
    await deleteNodes([groupId], "trash");
    await restoreNodes([groupId]);

    const nodes = byId(await listNodes());
    expect(group(nodes, groupId).parents).toEqual([ROOT_ID]);
    expect(group(nodes, TRASH_ID).children).not.toContain(groupId);
  });

  it("purges a group together with everything inside it", async () => {
    const outer = await parkUrls(["https://example.com/a"], "outer");
    const inner = await createGroup("inner", outer);
    const prepared = await prepareTabs([{ url: "https://example.com/b" }]);
    await commitPark(prepared, { targetParentId: inner });

    const before = (await listNodes()).length;
    const removed = await deleteNodes([outer], "purge");

    const nodes = byId(await listNodes());
    expect(removed).toBe(4); // outer, inner, its tab, and outer's tab
    expect((await listNodes()).length).toBe(before - 4);
    expect(nodes.has(outer)).toBe(false);
    expect(nodes.has(inner)).toBe(false);

    const tombstones = await listTombstones();
    expect(tombstones.map((tomb) => tomb.id)).toEqual(expect.arrayContaining([outer, inner]));
  });

  it("never deletes the system groups", async () => {
    const removed = await deleteNodes([ROOT_ID, QUICK_LIST_ID, TRASH_ID], "purge");
    expect(removed).toBe(0);
    expect(byId(await listNodes()).has(ROOT_ID)).toBe(true);
  });

  it("prunes old tombstones only", async () => {
    const groupId = await parkUrls(["https://example.com/a"], "gone");
    await deleteNodes([groupId], "purge");
    expect(await pruneTombstones(86_400_000)).toBe(0); // nothing is a day old yet
    expect(await pruneTombstones(-1)).toBeGreaterThan(0); // cutoff in the future: all eligible
  });
});

describe("editing", () => {
  it("updates tab fields and touches updatedAt", async () => {
    const groupId = await parkUrls(["https://example.com/a"]);
    const nodes = byId(await listNodes());
    const tabId = group(nodes, groupId).children[0] as string;
    const before = tab(nodes, tabId).updatedAt;

    await updateTab(tabId, { title: "Renamed", notes: "note", rating: 4 });

    const after = tab(byId(await listNodes()), tabId);
    expect(after.title).toBe("Renamed");
    expect(after.notes).toBe("note");
    expect(after.rating).toBe(4);
    expect(after.updatedAt).toBeGreaterThanOrEqual(before);
  });

  it("renames a group", async () => {
    const groupId = await createGroup("before");
    await updateGroup(groupId, { label: "after" });
    expect(group(byId(await listNodes()), groupId).label).toBe("after");
  });

  it("re-identifies a tab when its URL changes", async () => {
    const groupId = await parkUrls(["https://example.com/a"]);
    const nodes = byId(await listNodes());
    const oldId = group(nodes, groupId).children[0] as string;

    const newId = await updateTabUrl(oldId, "https://example.com/b");

    const after = byId(await listNodes());
    expect(newId).not.toBe(oldId);
    expect(after.has(oldId)).toBe(false);
    expect(tab(after, newId).url).toBe("https://example.com/b");
    expect(group(after, groupId).children).toEqual([newId]);
    expect((await listTombstones()).some((tomb) => tomb.id === oldId)).toBe(true);
  });
});

describe("quick list", () => {
  it("adds and removes membership without moving the record", async () => {
    const groupId = await parkUrls(["https://example.com/a"]);
    const nodes = byId(await listNodes());
    const tabId = group(nodes, groupId).children[0] as string;

    await setQuickList(tabId, true);
    let after = byId(await listNodes());
    expect(tab(after, tabId).parents).toEqual([groupId, QUICK_LIST_ID]);
    expect(group(after, QUICK_LIST_ID).children).toContain(tabId);

    await setQuickList(tabId, false);
    after = byId(await listNodes());
    expect(tab(after, tabId).parents).toEqual([groupId]);
    expect(group(after, QUICK_LIST_ID).children).not.toContain(tabId);
  });
});

describe("repair", () => {
  it("drops dangling children and restores missing backlinks", async () => {
    const groupId = await parkUrls(["https://example.com/a"], "broken");
    const nodes = byId(await listNodes());
    const tabId = group(nodes, groupId).children[0] as string;

    // Corrupt the tree the way a partially applied remote batch could.
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open(DB_NAME);
      request.onsuccess = () => {
        const db = request.result;
        const transaction = db.transaction("node", "readwrite");
        const store = transaction.objectStore("node");
        const broken = group(nodes, groupId);
        broken.children = [tabId, "does-not-exist"];
        store.put(broken);
        const orphan = tab(nodes, tabId);
        orphan.parents = [];
        store.put(orphan);
        transaction.oncomplete = () => {
          db.close();
          resolve();
        };
        transaction.onerror = () => reject(transaction.error);
      };
      request.onerror = () => reject(request.error);
    });

    resetDbConnectionForTests();
    const report = await repair();

    expect(report.danglingChildren).toBe(1);
    expect(report.missingBacklinks).toBe(1);
    const fixed = byId(await listNodes());
    expect(group(fixed, groupId).children).toEqual([tabId]);
    expect(tab(fixed, tabId).parents).toEqual([groupId]);
  });
});

describe("journal", () => {
  it("stays silent until the sync engine enables it", async () => {
    expect(isJournalEnabled()).toBe(false);
    await parkUrls(["https://example.com/a"]);
    const writes = await new Promise<number>((resolve, reject) => {
      const request = indexedDB.open(DB_NAME);
      request.onsuccess = () => {
        const db = request.result;
        const transaction = db.transaction("change", "readonly");
        const count = transaction.objectStore("change").count();
        count.onsuccess = () => {
          db.close();
          resolve(count.result);
        };
        count.onerror = () => reject(count.error);
      };
      request.onerror = () => reject(request.error);
    });
    expect(writes).toBe(0);
  });

  it("records one entry per change when enabled", async () => {
    setJournalEnabled(true);
    const groupId = await parkUrls(["https://example.com/a"], "journalled");
    const node = await getNode(groupId);
    expect(node).toBeDefined();

    const entries = await new Promise<number>((resolve, reject) => {
      const request = indexedDB.open(DB_NAME);
      request.onsuccess = () => {
        const db = request.result;
        const transaction = db.transaction("change", "readonly");
        const count = transaction.objectStore("change").count();
        count.onsuccess = () => {
          db.close();
          resolve(count.result);
        };
        count.onerror = () => reject(count.error);
      };
      request.onerror = () => reject(request.error);
    });
    // group upsert + tab upsert + reorder
    expect(entries).toBeGreaterThanOrEqual(3);
  });
});

describe("trash origin", () => {
  it("remembers the list a moved record came from", async () => {
    const groupId = await parkUrls(["https://example.com/a"], "origin list");
    const nodes = byId(await listNodes());
    const tabId = group(nodes, groupId).children[0] as string;

    await deleteNodes([tabId], "trash");

    const trashed = tab(byId(await listNodes()), tabId);
    expect(trashed.parents).toEqual([TRASH_ID]);
    expect(trashed.trashedFrom).toBe(groupId);
  });

  it("restores it into that list", async () => {
    const groupId = await parkUrls(["https://example.com/a"], "origin list");
    const nodes = byId(await listNodes());
    const tabId = group(nodes, groupId).children[0] as string;
    await deleteNodes([tabId], "trash");

    await restoreNodes([tabId]);

    const after = byId(await listNodes());
    expect(tab(after, tabId).parents).toEqual([groupId]);
    expect(tab(after, tabId).trashedFrom).toBeUndefined();
    expect(group(after, groupId).children).toContain(tabId);
  });

  it("restores a whole list to where it was", async () => {
    const outer = await createGroup("outer");
    const inner = await createGroup("inner", outer);
    await deleteNodes([inner], "trash");

    await restoreNodes([inner]);

    const after = byId(await listNodes());
    expect(group(after, inner).parents).toEqual([outer]);
    expect(group(after, outer).children).toContain(inner);
  });

  it("falls back to the root when the original list is gone", async () => {
    const groupId = await parkUrls(["https://example.com/a"], "doomed");
    const nodes = byId(await listNodes());
    const tabId = group(nodes, groupId).children[0] as string;
    await deleteNodes([tabId], "trash");
    await deleteNodes([groupId], "purge");

    await restoreNodes([tabId]);

    expect(tab(byId(await listNodes()), tabId).parents).toEqual([ROOT_ID]);
  });

  it("still honours an explicit destination", async () => {
    const source = await parkUrls(["https://example.com/a"], "source");
    const target = await createGroup("target");
    const nodes = byId(await listNodes());
    const tabId = group(nodes, source).children[0] as string;
    await deleteNodes([tabId], "trash");

    await restoreNodes([tabId], target);

    expect(tab(byId(await listNodes()), tabId).parents).toEqual([target]);
  });
});
