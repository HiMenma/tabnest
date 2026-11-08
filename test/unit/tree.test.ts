import { describe, expect, it } from "vitest";
import type { Group, Node, TabItem } from "../../src/data/model";
import {
  ancestorsOf,
  childrenOf,
  countTabs,
  directTabs,
  formatDate,
  isRenamable,
  searchTabs,
  subtreeTabs,
} from "../../src/ui/data/tree";

function tab(id: string, title: string, url = `https://example.com/${id}`): TabItem {
  return {
    id,
    kind: "tab",
    url,
    title,
    host: "example.com",
    parents: [],
    createdAt: 1,
    updatedAt: 1,
  };
}

function group(id: string, children: string[], parents: string[] = []): Group {
  return {
    id,
    kind: "group",
    groupType: "folder",
    label: id,
    children,
    parents,
    createdAt: 1,
    updatedAt: 1,
  };
}

function mapOf(nodes: Node[]): Map<string, Node> {
  return new Map(nodes.map((node) => [node.id, node]));
}

const sample: Node[] = [
  group("root", ["g1", "g2"]),
  group("g1", ["t1", "t2"], ["root"]),
  group("g2", ["t3", "g3"], ["root"]),
  group("g3", ["t4"], ["g2"]),
  { ...tab("t1", "Alpha docs"), parents: ["g1"] },
  { ...tab("t2", "Beta", "https://beta.example/b"), parents: ["g1"] },
  { ...tab("t3", "Gamma", "https://gamma.example/c"), parents: ["g2"] },
  { ...tab("t4", "Delta needle", "https://delta.example/d"), parents: ["g3"] },
];

describe("tree helpers", () => {
  it("returns children in recorded order, skipping missing ids", () => {
    const map = mapOf([...sample, group("g9", ["t1", "gone"], ["root"])]);
    const children = childrenOf(map, "g9");
    expect(children.map((node) => node.id)).toEqual(["t1"]);
  });

  it("walks ancestors from the root down", () => {
    const map = mapOf(sample);
    expect(ancestorsOf(map, "t4").map((node) => node.id)).toEqual(["root", "g2", "g3"]);
  });

  it("collects subtree tabs depth first", () => {
    const map = mapOf(sample);
    expect(subtreeTabs(map, "g2").map((node) => node.id)).toEqual(["t3", "t4"]);
    expect(countTabs(map, "root")).toBe(4);
    expect(directTabs(map, "g1").map((node) => node.id)).toEqual(["t1", "t2"]);
  });

  it("survives cycles instead of hanging", () => {
    const cyclic = mapOf([group("a", ["b"]), group("b", ["a"])]);
    expect(countTabs(cyclic, "a")).toBe(0);
  });
});

describe("search", () => {
  it("matches title, url, host and notes", () => {
    const map = mapOf(sample);
    expect(searchTabs(map, "alpha").map((hit) => hit.node.id)).toEqual(["t1"]);
    expect(searchTabs(map, "beta.example").map((hit) => hit.node.id)).toEqual(["t2"]);
    expect(searchTabs(map, "gamma").map((hit) => hit.node.id)).toEqual(["t3"]);
    expect(searchTabs(map, "needle").map((hit) => hit.node.id)).toEqual(["t4"]);
  });

  it("requires every term to match", () => {
    const map = mapOf(sample);
    expect(searchTabs(map, "delta needle")).toHaveLength(1);
    expect(searchTabs(map, "delta nothing")).toHaveLength(0);
  });

  it("reports where a hit lives", () => {
    const map = mapOf(sample);
    const [hit] = searchTabs(map, "needle");
    expect(hit?.trail).toBe("root / g2 / g3");
  });

  it("ignores an empty query", () => {
    expect(searchTabs(mapOf(sample), "   ")).toEqual([]);
  });

  it("scans 5000 records in well under 50 ms", () => {
    const nodes: Node[] = [group("root", [])];
    for (let index = 0; index < 5000; index++) {
      const id = `t${index}`;
      nodes.push({ ...tab(id, `Item ${index}`), parents: ["root"] });
      (nodes[0] as Group).children.push(id);
    }
    const map = mapOf(nodes);

    const started = performance.now();
    const hits = searchTabs(map, "Item 4999");
    const elapsed = performance.now() - started;

    expect(hits).toHaveLength(1);
    expect(elapsed).toBeLessThan(50);
  });
});

describe("formatDate", () => {
  it("shows the time for today and a date otherwise", () => {
    const now = Date.now();
    expect(formatDate(now)).toMatch(/\d/);
    const old = Date.UTC(2020, 0, 2, 12);
    expect(formatDate(old)).toMatch(/2020|Jan/);
    expect(formatDate(0)).toBe("");
  });
});

describe("isRenamable", () => {
  it("allows the lists a user creates", () => {
    for (const groupType of ["folder", "window", "tabGroup"] as const) {
      expect(isRenamable({ ...group("x", []), groupType, parents: ["root"] })).toBe(true);
    }
  });

  it("refuses the system containers", () => {
    for (const id of ["root", "quickList", "trash"]) {
      expect(isRenamable(group(id, []))).toBe(false);
    }
  });

  it("refuses tabs and missing nodes", () => {
    expect(isRenamable(tab("t1", "A"))).toBe(false);
    expect(isRenamable(undefined)).toBe(false);
  });
});
