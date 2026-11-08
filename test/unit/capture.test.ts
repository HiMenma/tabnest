import { beforeEach, describe, expect, it } from "vitest";
import { describeOutcome, park } from "../../src/background/capture";
import { DB_NAME, resetDbConnectionForTests } from "../../src/data/idb";
import { type Group, type Node, ROOT_ID, type TabItem, TRASH_ID } from "../../src/data/model";
import { getSettings, listNodes, patchSettings } from "../../src/data/repo";

interface FakeTab {
  id: number;
  index: number;
  windowId: number;
  url: string;
  title: string;
  pinned: boolean;
  groupId: number;
  active: boolean;
}

const NO_GROUP = -1;

let store: FakeTab[] = [];
let removed: number[] = [];

function installChrome(tabs: FakeTab[], tabGroups?: { titles: Record<number, string> }): void {
  store = tabs.map((tab) => ({ ...tab }));
  removed = [];

  const matches = (tab: FakeTab, query: Record<string, unknown>): boolean => {
    if (query.windowId !== undefined && tab.windowId !== query.windowId) return false;
    if (query.active !== undefined && tab.active !== query.active) return false;
    if (query.currentWindow === true && tab.windowId !== 1) return false;
    return true;
  };

  const chromeStub = {
    tabs: {
      query: async (query: Record<string, unknown> = {}) =>
        store.filter((tab) => matches(tab, query)),
      get: async (id: number) => {
        const found = store.find((tab) => tab.id === id);
        if (!found) throw new Error(`no tab ${id}`);
        return found;
      },
      remove: async (ids: number | number[]) => {
        const list = Array.isArray(ids) ? ids : [ids];
        for (const id of list) {
          if (!store.some((tab) => tab.id === id)) throw new Error(`no tab ${id}`);
          removed.push(id);
        }
        store = store.filter((tab) => !list.includes(tab.id));
      },
    },
    windows: { getCurrent: async () => ({ id: 1 }) },
    tabGroups: tabGroups
      ? {
          get: async (id: number) => ({ id, title: tabGroups.titles[id] ?? "" }),
        }
      : undefined,
  };

  (globalThis as unknown as { chrome: unknown }).chrome = chromeStub;
}

function tab(partial: Partial<FakeTab> & { id: number; url: string }): FakeTab {
  return {
    index: partial.id,
    windowId: 1,
    title: partial.url,
    pinned: false,
    groupId: NO_GROUP,
    active: false,
    ...partial,
  };
}

async function freshDb(): Promise<void> {
  resetDbConnectionForTests();
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => resolve();
  });
}

async function nodesById(): Promise<Map<string, Node>> {
  return new Map((await listNodes()).map((node) => [node.id, node]));
}

function asGroup(nodes: Map<string, Node>, id: string): Group {
  const node = nodes.get(id);
  if (node?.kind !== "group") throw new Error(`${id} is not a group`);
  return node;
}

function asTab(nodes: Map<string, Node>, id: string): TabItem {
  const node = nodes.get(id);
  if (node?.kind !== "tab") throw new Error(`${id} is not a tab`);
  return node;
}

beforeEach(async () => {
  await freshDb();
  installChrome([]);
});

describe("parking a window", () => {
  it("records tabs in tab-strip order and closes them", async () => {
    installChrome([
      tab({ id: 1, url: "https://a.example/1", index: 0, title: "First" }),
      tab({ id: 2, url: "https://b.example/2", index: 1, title: "Second" }),
      tab({ id: 3, url: "https://c.example/3", index: 2, title: "Third" }),
    ]);

    const outcome = await park({ kind: "window" });
    expect(outcome.added).toBe(3);
    expect(outcome.closedTabs).toBe(3);
    expect(outcome.groupIds).toHaveLength(1);

    const nodes = await nodesById();
    const group = asGroup(nodes, outcome.groupIds[0] as string);
    expect(group.label).toBe("First");
    expect(group.children).toHaveLength(3);
    expect(group.children.map((id) => asTab(nodes, id).title)).toEqual([
      "First",
      "Second",
      "Third",
    ]);
    expect(asGroup(nodes, ROOT_ID).children).toContain(group.id);
    expect(removed.sort()).toEqual([1, 2, 3]);
  });

  it("drops unparkable tabs silently", async () => {
    installChrome([
      tab({ id: 1, url: "chrome://settings", index: 0 }),
      tab({ id: 2, url: "about:blank", index: 1 }),
      tab({ id: 3, url: "https://keep.example/x", index: 2 }),
    ]);
    const outcome = await park({ kind: "window" });
    expect(outcome.added).toBe(1);
  });

  it("leaves pinned tabs alone by default", async () => {
    installChrome([
      tab({ id: 1, url: "https://pinned.example/", pinned: true, index: 0 }),
      tab({ id: 2, url: "https://normal.example/", index: 1 }),
    ]);
    const outcome = await park({ kind: "window" });
    expect(outcome.added).toBe(1);
    expect(outcome.pinnedSkipped).toBe(1);
    expect(removed).toEqual([2]);
  });

  it("parks pinned tabs when asked to", async () => {
    await patchSettings({ pinned: "park" });
    installChrome([
      tab({ id: 1, url: "https://pinned.example/", pinned: true, index: 0 }),
      tab({ id: 2, url: "https://normal.example/", index: 1 }),
    ]);
    const outcome = await park({ kind: "window" });
    expect(outcome.added).toBe(2);
  });

  it("refuses the whole operation when the pinned policy says stop", async () => {
    await patchSettings({ pinned: "stop" });
    installChrome([
      tab({ id: 1, url: "https://pinned.example/", pinned: true, index: 0 }),
      tab({ id: 2, url: "https://normal.example/", index: 1 }),
    ]);
    const outcome = await park({ kind: "window" });
    expect(outcome.refusedDueToPinned).toBe(true);
    expect(outcome.added).toBe(0);
    expect(removed).toEqual([]);
  });

  it("honours the excluded-domain list and never closes those tabs", async () => {
    await patchSettings({ excludedDomains: ["bank.example"] });
    installChrome([
      tab({ id: 1, url: "https://bank.example/account", index: 0 }),
      tab({ id: 2, url: "https://news.example/", index: 1 }),
    ]);
    const outcome = await park({ kind: "window" });
    expect(outcome.added).toBe(1);
    expect(outcome.excluded).toBe(1);
    expect(removed).toEqual([2]);
  });

  it("quarantines absurdly long URLs instead of storing them", async () => {
    const longUrl = `https://example.com/${"a".repeat(66_000)}`;
    installChrome([
      tab({ id: 1, url: longUrl, index: 0 }),
      tab({ id: 2, url: "https://fine.example/", index: 1 }),
    ]);
    const outcome = await park({ kind: "window" });
    expect(outcome.added).toBe(1);
    expect(outcome.quarantined).toBe(1);
    const nodes = await nodesById();
    for (const node of nodes.values()) {
      if (node.kind === "tab") expect(node.url.length).toBeLessThan(1_000);
    }
  });

  it("does not duplicate a second park of the same window", async () => {
    const tabs = [
      tab({ id: 1, url: "https://a.example/1", index: 0 }),
      tab({ id: 2, url: "https://b.example/2", index: 1 }),
    ];
    installChrome(tabs);
    const first = await park({ kind: "window" });
    expect(first.added).toBe(2);

    const afterFirst = (await listNodes()).length;
    installChrome(tabs); // the tabs came back (or were never closed)
    const second = await park({ kind: "window" });

    expect(second.added).toBe(0);
    expect(second.skipped).toBe(2);
    expect((await listNodes()).length).toBe(afterFirst);
  });

  it("leaves tabs open when closeAfter is never", async () => {
    await patchSettings({ closeAfter: "never" });
    installChrome([tab({ id: 1, url: "https://a.example/", index: 0 })]);
    const outcome = await park({ kind: "window" });
    expect(outcome.added).toBe(1);
    expect(removed).toEqual([]);
  });
});

describe("scopes", () => {
  it("parks everything except the active tab", async () => {
    installChrome([
      tab({ id: 1, url: "https://a.example/", index: 0 }),
      tab({ id: 2, url: "https://b.example/", index: 1, active: true }),
      tab({ id: 3, url: "https://c.example/", index: 2 }),
    ]);
    const outcome = await park({ kind: "all-except-current" });
    expect(outcome.added).toBe(2);
    expect(removed).not.toContain(2);
  });

  it("parks only tabs to the left of the active one", async () => {
    installChrome([
      tab({ id: 1, url: "https://a.example/", index: 0 }),
      tab({ id: 2, url: "https://b.example/", index: 1, active: true }),
      tab({ id: 3, url: "https://c.example/", index: 2 }),
    ]);
    const outcome = await park({ kind: "left" });
    expect(outcome.added).toBe(1);
    expect(removed).toEqual([1]);
  });

  it("parks a single current tab", async () => {
    installChrome([
      tab({ id: 1, url: "https://a.example/", index: 0 }),
      tab({ id: 2, url: "https://b.example/", index: 1, active: true }),
    ]);
    const outcome = await park({ kind: "current-tab" });
    expect(outcome.added).toBe(1);
    expect(outcome.groupIds).toHaveLength(1);
  });

  it("parks the active tab group when the tab group API is available", async () => {
    installChrome(
      [
        tab({ id: 1, url: "https://loose.example/", index: 0 }),
        tab({ id: 2, url: "https://work.example/a", index: 1, groupId: 7, active: true }),
        tab({ id: 3, url: "https://work.example/b", index: 2, groupId: 7 }),
        tab({ id: 4, url: "https://other.example/", index: 3, groupId: 9 }),
      ],
      { titles: { 7: "Work", 9: "Other" } },
    );
    const outcome = await park({ kind: "tab-group" });
    expect(outcome.added).toBe(2);
    expect(removed.sort()).toEqual([2, 3]);

    const nodes = await nodesById();
    const group = asGroup(nodes, outcome.groupIds[0] as string);
    expect(group.label).toBe("Work");
    expect(group.groupType).toBe("tabGroup");
  });

  it("nests Chrome tab groups inside the window group when asked", async () => {
    installChrome(
      [
        tab({ id: 1, url: "https://loose.example/", index: 0 }),
        tab({ id: 2, url: "https://work.example/a", index: 1, groupId: 7 }),
        tab({ id: 3, url: "https://work.example/b", index: 2, groupId: 7 }),
      ],
      { titles: { 7: "Work" } },
    );
    const outcome = await park({ kind: "window" });
    expect(outcome.added).toBe(3);

    const nodes = await nodesById();
    const windowGroup = asGroup(nodes, outcome.groupIds[0] as string);
    expect(windowGroup.groupType).toBe("window");
    const nested = asGroup(nodes, outcome.groupIds[1] as string);
    expect(nested.groupType).toBe("tabGroup");
    expect(nested.label).toBe("Work");
    expect(nested.children).toHaveLength(2);
    expect(windowGroup.children).toContain(nested.id);
  });
});

describe("outcomes", () => {
  it("describes what happened in one line", () => {
    expect(
      describeOutcome({
        added: 3,
        skipped: 1,
        excluded: 2,
        pinnedSkipped: 1,
        quarantined: 0,
        groupIds: [],
        closedTabs: 3,
        refusedDueToPinned: false,
      }),
    ).toBe("3 parked · 1 already saved · 2 excluded · 1 pinned left");
  });

  it("trash is still empty after parking", async () => {
    installChrome([tab({ id: 1, url: "https://a.example/", index: 0 })]);
    await park({ kind: "window" });
    const nodes = await nodesById();
    expect(asGroup(nodes, TRASH_ID).children).toEqual([]);
  });

  it("keeps settings untouched", async () => {
    installChrome([tab({ id: 1, url: "https://a.example/", index: 0 })]);
    await park({ kind: "window" });
    const settings = await getSettings();
    expect(settings.alreadyParked).toBe("skip");
  });
});
