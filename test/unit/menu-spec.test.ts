import { describe, expect, it } from "vitest";
import {
  buildMenuSpec,
  MENU_ID,
  type MenuInput,
  recentGroupIdFromMenuId,
  recentGroupsFrom,
} from "../../src/background/menu-spec";
import type { Node } from "../../src/data/model";

const base: MenuInput = {
  activeHost: "www.example.com",
  excluded: false,
  inTabGroup: false,
  highlightedCount: 1,
  recentGroups: [
    { id: "g1", label: "Reading list" },
    { id: "g2", label: "Research" },
  ],
};

const ids = (input: MenuInput): string[] => buildMenuSpec(input).map((item) => item.id);
const find = (input: MenuInput, id: string) => buildMenuSpec(input).find((item) => item.id === id);

describe("buildMenuSpec", () => {
  it("lists the items in the order the menu shows them", () => {
    expect(ids(base)).toEqual([
      MENU_ID.openLibrary,
      MENU_ID.separator,
      MENU_ID.parkWindow,
      MENU_ID.parkTabGroup,
      MENU_ID.parkSelection,
      `${MENU_ID.separator}-2`,
      MENU_ID.parkCurrentTab,
      MENU_ID.parkAllExceptCurrent,
      MENU_ID.parkLeft,
      MENU_ID.parkRight,
      MENU_ID.parkAllWindows,
      `${MENU_ID.separator}-3`,
      MENU_ID.toggleExclude,
      MENU_ID.recentGroups,
      `${MENU_ID.recentChildPrefix}g1`,
      `${MENU_ID.recentChildPrefix}g2`,
      `${MENU_ID.separator}-4`,
      MENU_ID.help,
      MENU_ID.parkLink,
    ]);
  });

  it("disables the tab-group action outside a tab group", () => {
    expect(find(base, MENU_ID.parkTabGroup)?.enabled).toBe(false);
    expect(find({ ...base, inTabGroup: true }, MENU_ID.parkTabGroup)?.enabled).toBe(true);
  });

  it("disables the selection action until two tabs are highlighted", () => {
    expect(find({ ...base, highlightedCount: 1 }, MENU_ID.parkSelection)?.enabled).toBe(false);
    const two = find({ ...base, highlightedCount: 2 }, MENU_ID.parkSelection);
    expect(two?.enabled).toBe(true);
    expect(two?.titleVars).toEqual({ count: 2 });
  });

  it("names the exclusion row after the active host and checks it when excluded", () => {
    const unchecked = find(base, MENU_ID.toggleExclude);
    expect(unchecked?.type).toBe("checkbox");
    expect(unchecked?.titleVars).toEqual({ host: "www.example.com" });
    expect(unchecked?.checked).toBe(false);
    expect(find({ ...base, excluded: true }, MENU_ID.toggleExclude)?.checked).toBe(true);
  });

  it("hides the exclusion row when the tab has no host", () => {
    const spec = buildMenuSpec({ ...base, activeHost: null });
    expect(spec.some((item) => item.id === MENU_ID.toggleExclude)).toBe(false);
    expect(spec.some((item) => item.id === `${MENU_ID.separator}-3`)).toBe(false);
  });

  it("puts recent lists under a submenu parent", () => {
    const spec = buildMenuSpec(base);
    const parent = spec.find((item) => item.id === MENU_ID.recentGroups);
    expect(parent?.contexts).toEqual(["action"]);
    const children = spec.filter((item) => item.parentId === MENU_ID.recentGroups);
    expect(children).toHaveLength(2);
    expect(children[0]?.contexts).toBeUndefined();
  });

  it("shows one disabled row when there are no lists yet", () => {
    const spec = buildMenuSpec({ ...base, recentGroups: [] });
    const children = spec.filter((item) => item.parentId === MENU_ID.recentGroups);
    expect(children).toHaveLength(1);
    expect(children[0]?.id).toBe(MENU_ID.recentEmpty);
    expect(children[0]?.enabled).toBe(false);
  });

  it("caps the submenu", () => {
    const many = Array.from({ length: 12 }, (_, index) => ({
      id: `g${index}`,
      label: `L${index}`,
    }));
    const spec = buildMenuSpec({ ...base, recentGroups: many, recentLimit: 4 });
    expect(spec.filter((item) => item.parentId === MENU_ID.recentGroups)).toHaveLength(4);
  });

  it("keeps the link action on the link context only", () => {
    expect(find(base, MENU_ID.parkLink)?.contexts).toEqual(["link"]);
    expect(find(base, MENU_ID.parkWindow)?.contexts).toEqual(["action", "page"]);
  });
});

describe("recentGroupIdFromMenuId", () => {
  it("extracts the id", () => {
    expect(recentGroupIdFromMenuId(`${MENU_ID.recentChildPrefix}abc-123`)).toBe("abc-123");
  });

  it("ignores everything else", () => {
    expect(recentGroupIdFromMenuId(MENU_ID.recentGroups)).toBeNull();
    expect(recentGroupIdFromMenuId(`${MENU_ID.recentChildPrefix}`)).toBeNull();
    expect(recentGroupIdFromMenuId(MENU_ID.parkWindow)).toBeNull();
  });
});

describe("recentGroupsFrom", () => {
  const nodes = [
    { id: "root", kind: "group", groupType: "root", createdAt: 999 },
    // The trash is a folder, so it needs an explicit exclusion.
    { id: "trash", kind: "group", groupType: "folder", createdAt: 998 },
    { id: "quickList", kind: "group", groupType: "quickList", createdAt: 997 },
    { id: "a", kind: "group", groupType: "folder", label: "Older", createdAt: 10 },
    { id: "b", kind: "group", groupType: "window", label: "Newer", createdAt: 30 },
    { id: "c", kind: "group", groupType: "tabGroup", label: "", createdAt: 20 },
    { id: "t", kind: "tab", createdAt: 40 },
  ] as unknown as Node[];

  it("keeps only user lists, newest first", () => {
    const recent = recentGroupsFrom(nodes);
    expect(recent.map((group) => group.id)).toEqual(["b", "c", "a"]);
  });

  it("never offers the system containers", () => {
    const ids = recentGroupsFrom(nodes).map((group) => group.id);
    expect(ids).not.toContain("trash");
    expect(ids).not.toContain("quickList");
    expect(ids).not.toContain("root");
  });

  it("gives an unlabelled list a readable name", () => {
    expect(recentGroupsFrom(nodes).find((group) => group.id === "c")?.label).toBe("Untitled");
  });

  it("respects the limit", () => {
    expect(recentGroupsFrom(nodes, 2)).toHaveLength(2);
  });
});
