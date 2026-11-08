import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";
import { registerBackend } from "../../src/background/sync/backend/index";
import { createMemoryStore } from "../../src/background/sync/backend/memory";
import { SyncEngine } from "../../src/background/sync/engine";
import { deleteDb, setIndexedDbFactory } from "../../src/data/idb";
import { type Group, type Node, ROOT_ID } from "../../src/data/model";
import {
  commitPark,
  deleteNodes,
  getNode,
  listNodes,
  loadSnapshot,
  prepareTabs,
} from "../../src/data/repo";

const shared = new Map<string, Uint8Array>();

registerBackend({
  id: "memory",
  labelKey: "test.memory",
  needsConfig: false,
  encryption: "off",
  create: async () => createMemoryStore("memory", shared),
});

function makeEngine(): SyncEngine {
  return new SyncEngine(async () => createMemoryStore("memory", shared));
}

/** Points the data layer at a fresh "device" database. */
async function useDevice(factory: IDBFactory): Promise<void> {
  setIndexedDbFactory(factory);
  await deleteDb();
}

async function parkOne(title: string, url: string, label: string): Promise<void> {
  const prepared = await prepareTabs([{ url, title }]);
  await commitPark(prepared, { groupLabel: label });
}

function requireStoreId(status: { storeId?: string }): string {
  if (!status.storeId) throw new Error("configure did not return a store id");
  return status.storeId;
}

function chunkKeys(): string[] {
  return [...shared.keys()].filter((key) => key.includes("/d/")).sort();
}

function groupByLabel(nodes: readonly Node[], label: string): Group | undefined {
  return nodes.find((node): node is Group => node.kind === "group" && node.label === label);
}

beforeEach(() => {
  shared.clear();
});

describe("engine", () => {
  it("starts unconfigured and journals nothing until configured", async () => {
    await useDevice(new IDBFactory());
    const engine = makeEngine();
    await engine.init();
    expect((await engine.status()).phase).toBe("unconfigured");
    expect((await engine.status()).queued).toBe(0);
  });

  it("pushes local changes as chunks", async () => {
    await useDevice(new IDBFactory());
    const engine = makeEngine();
    await engine.init();
    const configured = await engine.configure({ backendId: "memory" });
    expect(configured.phase).toBe("idle");
    expect(configured.storeId).toBeTruthy();

    await parkOne("Alpha", "https://a.example/alpha", "Group A");
    expect((await engine.status()).queued).toBeGreaterThan(0);

    await engine.syncNow();
    expect(chunkKeys().length).toBeGreaterThan(0);
    expect((await engine.status()).queued).toBe(0);
  });

  it("is idempotent when nothing changed", async () => {
    await useDevice(new IDBFactory());
    const engine = makeEngine();
    await engine.init();
    await engine.configure({ backendId: "memory" });
    await parkOne("Alpha", "https://a.example/alpha", "Group A");
    await engine.syncNow();

    const before = chunkKeys().length;
    await engine.syncNow();
    expect(chunkKeys().length).toBe(before);
  });

  it("replicates to a second device", async () => {
    const factoryA = new IDBFactory();
    await useDevice(factoryA);
    const a = makeEngine();
    await a.init();
    const statusA = await a.configure({ backendId: "memory" });
    await parkOne("Alpha", "https://a.example/alpha", "Group A");
    await a.syncNow();

    const factoryB = new IDBFactory();
    await useDevice(factoryB);
    const b = makeEngine();
    await b.init();
    await b.configure({ backendId: "memory", storeId: requireStoreId(statusA) });
    await b.syncNow();

    const nodes = await listNodes();
    const replicated = groupByLabel(nodes, "Group A");
    expect(replicated).toBeDefined();
    const copied = await getNode(replicated?.children[0] ?? "");
    expect(copied?.kind).toBe("tab");
    expect(copied?.kind === "tab" ? copied.title : "").toBe("Alpha");
  });

  it("converges when both devices change things", async () => {
    const factoryA = new IDBFactory();
    await useDevice(factoryA);
    const a = makeEngine();
    await a.init();
    const statusA = await a.configure({ backendId: "memory" });
    await parkOne("From A", "https://a.example/1", "Shared");
    await a.syncNow();

    const factoryB = new IDBFactory();
    await useDevice(factoryB);
    const b = makeEngine();
    await b.init();
    await b.configure({ backendId: "memory", storeId: requireStoreId(statusA) });
    await b.syncNow();

    // B adds its own tab to the replicated group.
    const nodesB = await listNodes();
    const groupB = groupByLabel(nodesB, "Shared");
    expect(groupB).toBeDefined();
    const prepared = await prepareTabs([{ url: "https://b.example/2", title: "From B" }]);
    await commitPark(prepared, { targetParentId: groupB?.id ?? ROOT_ID });
    await b.syncNow();

    // A catches up and sees both tabs.
    setIndexedDbFactory(factoryA);
    await a.syncNow();
    const nodesA = await listNodes();
    const groupA = groupByLabel(nodesA, "Shared");
    expect(groupA).toBeDefined();
    const titles: string[] = [];
    for (const childId of groupA?.children ?? []) {
      const child = nodesA.find((node) => node.id === childId);
      if (child?.kind === "tab") titles.push(child.title);
    }
    expect(titles.sort()).toEqual(["From A", "From B"]);
  });

  it("propagates a purge as a deletion", async () => {
    const factoryA = new IDBFactory();
    await useDevice(factoryA);
    const a = makeEngine();
    await a.init();
    const statusA = await a.configure({ backendId: "memory" });
    await parkOne("Doomed", "https://a.example/doomed", "Group D");
    await a.syncNow();

    const factoryB = new IDBFactory();
    await useDevice(factoryB);
    const b = makeEngine();
    await b.init();
    await b.configure({ backendId: "memory", storeId: requireStoreId(statusA) });
    await b.syncNow();
    expect(groupByLabel(await listNodes(), "Group D")).toBeDefined();

    setIndexedDbFactory(factoryA);
    const group = groupByLabel(await listNodes(), "Group D");
    await deleteNodes([group?.id ?? ""], "purge");
    await a.syncNow();

    setIndexedDbFactory(factoryB);
    await b.syncNow();
    expect(groupByLabel(await listNodes(), "Group D")).toBeUndefined();
  });

  it("compacts its own chunk history into a snapshot", async () => {
    await useDevice(new IDBFactory());
    const engine = makeEngine();
    await engine.init();
    await engine.configure({ backendId: "memory" });

    // One chunk per sync, enough to cross the compaction threshold.
    for (let index = 0; index < 34; index++) {
      await commitPark(await prepareTabs([{ url: `https://a.example/${index}` }]), {
        groupLabel: `G${index}`,
      });
      await engine.syncNow();
    }

    const chunks = chunkKeys();
    expect(chunks.length).toBeLessThan(34);
    // The remaining history still describes the whole library.
    const snapshot = await loadSnapshot();
    expect(snapshot.stats.groups).toBeGreaterThanOrEqual(34);
  });

  it("refuses to overrun a small backend and pauses", async () => {
    await useDevice(new IDBFactory());
    const tiny = new Map<string, Uint8Array>();
    const engine = new SyncEngine(async () =>
      createMemoryStore("memory", tiny, { caps: { maxTotalBytes: 400 } }),
    );
    await engine.init();
    const configured = await engine.configure({ backendId: "memory" });
    // The first upload already cannot fit, and says so instead of throwing.
    expect(configured.phase).toBe("paused");
    expect(configured.message ?? "").toMatch(/exceed|full|fit/i);

    for (let index = 0; index < 20; index++) {
      await commitPark(
        await prepareTabs([{ url: `https://a.example/${index}`, title: `T${index}` }]),
        {
          groupLabel: `G${index}`,
        },
      );
    }
    await engine.syncNow();

    const status = await engine.status();
    expect(status.phase).toBe("paused");
    expect(status.message ?? "").toMatch(/exceed|full|fit/i);
    // Local data is untouched by a failed push.
    expect((await loadSnapshot()).stats.tabs).toBe(20);
    expect((await engine.status()).queued).toBeGreaterThan(0);
  });

  it("disables cleanly and stops journaling", async () => {
    await useDevice(new IDBFactory());
    const engine = makeEngine();
    await engine.init();
    await engine.configure({ backendId: "memory" });
    const status = await engine.disable();
    expect(status.phase).toBe("disabled");

    await parkOne("After disable", "https://a.example/x", "G");
    expect((await engine.status()).queued).toBe(0);
  });
});

describe("encrypted store", () => {
  registerBackend({
    id: "memory-enc",
    labelKey: "test.memoryEnc",
    needsConfig: false,
    encryption: "passphrase",
    create: async () => createMemoryStore("memory-enc", shared),
  });

  it("round-trips through a passphrase-protected store", async () => {
    const factoryA = new IDBFactory();
    await useDevice(factoryA);
    const a = new SyncEngine(async () => createMemoryStore("memory-enc", shared));
    await a.init();
    const statusA = await a.configure({ backendId: "memory-enc", passphrase: "correct horse" });

    await parkOne("Secret", "https://a.example/secret", "Private");
    await a.syncNow();

    // What lands in the store is ciphertext, not the title.
    const raw = [...shared.values()].map((bytes) => new TextDecoder().decode(bytes)).join("");
    expect(raw).not.toContain("Secret");
    expect(raw).not.toContain("a.example");

    const factoryB = new IDBFactory();
    await useDevice(factoryB);
    const b = new SyncEngine(async () => createMemoryStore("memory-enc", shared));
    await b.init();
    await b.configure({
      backendId: "memory-enc",
      storeId: requireStoreId(statusA),
      passphrase: "correct horse",
    });
    await b.syncNow();
    expect(groupByLabel(await listNodes(), "Private")).toBeDefined();
  });

  it("rejects a second device using the wrong passphrase", async () => {
    const factoryA = new IDBFactory();
    await useDevice(factoryA);
    const a = new SyncEngine(async () => createMemoryStore("memory-enc", shared));
    await a.init();
    const statusA = await a.configure({ backendId: "memory-enc", passphrase: "correct horse" });

    await useDevice(new IDBFactory());
    const b = new SyncEngine(async () => createMemoryStore("memory-enc", shared));
    await b.init();
    await expect(
      b.configure({
        backendId: "memory-enc",
        storeId: requireStoreId(statusA),
        passphrase: "wrong",
      }),
    ).rejects.toThrow(/passphrase/);
  });
});
