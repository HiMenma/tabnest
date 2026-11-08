import { beforeEach, describe, expect, it } from "vitest";
import { deleteDb, resetDbConnectionForTests } from "../../src/data/idb";
import type { ChangeOp } from "../../src/data/model";
import { type Group, type Node, ROOT_ID, type Settings, type TabItem } from "../../src/data/model";
import {
  applyRemoteOps,
  getNode,
  getSettings,
  listNodes,
  loadSnapshot,
  patchSettings,
  repair,
} from "../../src/data/repo";

function tab(id: string, title: string, updatedAt: number, parents: string[] = [ROOT_ID]): TabItem {
  return {
    id,
    kind: "tab",
    url: `https://example.com/${id}`,
    title,
    host: "example.com",
    parents,
    createdAt: 1,
    updatedAt,
  };
}

function group(id: string, children: string[], updatedAt: number): Group {
  return {
    id,
    kind: "group",
    groupType: "folder",
    label: id,
    children,
    parents: [ROOT_ID],
    createdAt: 1,
    updatedAt,
  };
}

async function seed(nodes: Node[]): Promise<void> {
  await applyRemoteOps(nodes.map((node) => ({ op: "upsert", node }) as ChangeOp));
}

function titleOf(node: Node | undefined): string | undefined {
  return node?.kind === "tab" ? node.title : undefined;
}

async function byId(): Promise<Map<string, Node>> {
  return new Map((await listNodes()).map((node) => [node.id, node]));
}

beforeEach(async () => {
  resetDbConnectionForTests();
  await deleteDb();
  await loadSnapshot(); // create + seed
});

describe("conflict resolution", () => {
  it("takes a newer remote update", async () => {
    await seed([tab("t1", "local", 100)]);
    await applyRemoteOps([{ op: "upsert", node: tab("t1", "remote", 200) }]);
    expect(titleOf(await getNode("t1"))).toBe("remote");
  });

  it("keeps a newer local update", async () => {
    await seed([tab("t1", "local", 300)]);
    await applyRemoteOps([{ op: "upsert", node: tab("t1", "remote", 200) }]);
    expect(titleOf(await getNode("t1"))).toBe("local");
  });

  it("converges on ties by preferring the larger serialisation", async () => {
    const local = tab("t1", "alpha", 200);
    const remote = tab("t1", "zeta", 200);
    await seed([local]);
    await applyRemoteOps([{ op: "upsert", node: remote }]);

    const after = await getNode("t1");
    const expected = JSON.stringify(local) >= JSON.stringify(remote) ? "alpha" : "zeta";
    expect(titleOf(after)).toBe(expected);

    // The same comparison from the other side reaches the same record.
    const localCopy = await getNode("t1");
    expect(JSON.stringify(localCopy)).toBe(JSON.stringify(after));
  });

  it("lets a deletion win over an older update", async () => {
    await seed([tab("t1", "local", 100)]);
    await applyRemoteOps([{ op: "delete", id: "t1", at: 150 }]);
    expect(await getNode("t1")).toBeUndefined();
  });

  it("ignores a deletion older than the local record", async () => {
    await seed([tab("t1", "local", 200)]);
    await applyRemoteOps([{ op: "delete", id: "t1", at: 150 }]);
    expect(await getNode("t1")).toBeDefined();
  });

  it("does not resurrect a record deleted after it was edited", async () => {
    await applyRemoteOps([{ op: "delete", id: "t1", at: 500 }]);
    await applyRemoteOps([{ op: "upsert", node: tab("t1", "late", 400) }]);
    expect(await getNode("t1")).toBeUndefined();
  });

  it("resurrects a record edited after the deletion", async () => {
    await applyRemoteOps([{ op: "delete", id: "t1", at: 100 }]);
    await applyRemoteOps([{ op: "upsert", node: tab("t1", "fresh", 200) }]);
    expect(titleOf(await getNode("t1"))).toBe("fresh");
  });

  it("merges children added to the same group on two devices", async () => {
    await seed([group("g", [], 100), tab("a", "A", 100, ["g"]), tab("b", "B", 100, ["g"])]);
    // Device one saw only `a`; device two adds `b` and re-orders the group.
    await applyRemoteOps([{ op: "reorder", id: "g", children: ["a"], at: 150 }]);
    await repair();

    const nodes = await byId();
    const merged = nodes.get("g") as Group;
    expect(merged.children.sort()).toEqual(["a", "b"]);
  });

  it("ignores a reorder older than the group", async () => {
    await seed([group("g", ["a", "b"], 300)]);
    await applyRemoteOps([{ op: "reorder", id: "g", children: ["b", "a"], at: 200 }]);
    expect(((await getNode("g")) as Group).children).toEqual(["a", "b"]);
  });

  it("applies a reorder newer than the group", async () => {
    await seed([group("g", ["a", "b"], 100)]);
    await applyRemoteOps([{ op: "reorder", id: "g", children: ["b", "a"], at: 200 }]);
    expect(((await getNode("g")) as Group).children).toEqual(["b", "a"]);
  });
});

describe("settings merge", () => {
  it("orders per key, so two devices can change different settings", async () => {
    const base = await getSettings();
    await applyRemoteOps([
      { op: "settings", patch: { theme: "dark" } as Partial<Settings>, at: 200 },
    ]);
    await applyRemoteOps([
      { op: "settings", patch: { closeAfter: "never" } as Partial<Settings>, at: 300 },
    ]);

    const settings = await getSettings();
    expect(settings.theme).toBe("dark");
    expect(settings.closeAfter).toBe("never");
    expect(settings.pinned).toBe(base.pinned);
  });

  it("keeps the newer value for the same key", async () => {
    await applyRemoteOps([{ op: "settings", patch: { theme: "dark" }, at: 200 }]);
    await applyRemoteOps([{ op: "settings", patch: { theme: "light" }, at: 100 }]);
    expect((await getSettings()).theme).toBe("dark");
  });

  it("learns the local timestamp when a setting is changed here", async () => {
    await patchSettings({ theme: "light" });
    await applyRemoteOps([{ op: "settings", patch: { theme: "dark" }, at: 1 }]);
    expect((await getSettings()).theme).toBe("light");
  });
});
