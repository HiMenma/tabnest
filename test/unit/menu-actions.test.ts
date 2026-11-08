import { beforeEach, describe, expect, it } from "vitest";
import { scopeForMenuId, toggleHostExclusion } from "../../src/background/actions";
import { MENU_ID } from "../../src/background/menu-spec";
import { deleteDb, resetDbConnectionForTests } from "../../src/data/idb";
import { getSettings } from "../../src/data/repo";

/** The smallest chrome the menu actions touch. */
function stubChrome(): void {
  (globalThis as unknown as { chrome: unknown }).chrome = {
    contextMenus: {
      removeAll: (cb?: () => void) => cb?.(),
      create: (_p: unknown, cb?: () => void) => cb?.(),
    },
    tabs: {
      query: async () => [],
      create: async () => ({ id: 1 }),
      update: async () => ({ id: 1 }),
    },
    windows: { update: async () => ({}) },
    action: { setBadgeText: async () => undefined, setBadgeBackgroundColor: async () => undefined },
    runtime: { getURL: (path: string) => `chrome-extension://test/${path}`, lastError: undefined },
  };
}

beforeEach(async () => {
  resetDbConnectionForTests();
  await deleteDb();
  stubChrome();
});

describe("menu id to park scope", () => {
  it("maps every send action", () => {
    expect(scopeForMenuId(MENU_ID.parkWindow)).toEqual({ kind: "window" });
    expect(scopeForMenuId(MENU_ID.parkTabGroup)).toEqual({ kind: "tab-group" });
    expect(scopeForMenuId(MENU_ID.parkCurrentTab)).toEqual({ kind: "current-tab" });
    expect(scopeForMenuId(MENU_ID.parkAllExceptCurrent)).toEqual({ kind: "all-except-current" });
    expect(scopeForMenuId(MENU_ID.parkLeft)).toEqual({ kind: "left" });
    expect(scopeForMenuId(MENU_ID.parkRight)).toEqual({ kind: "right" });
    expect(scopeForMenuId(MENU_ID.parkAllWindows)).toEqual({ kind: "all-windows" });
  });

  it("returns nothing for items handled elsewhere", () => {
    for (const id of [
      MENU_ID.openLibrary,
      MENU_ID.help,
      MENU_ID.toggleExclude,
      MENU_ID.parkSelection,
      MENU_ID.parkLink,
      MENU_ID.recentGroups,
      "nonsense",
    ]) {
      expect(scopeForMenuId(id)).toBeUndefined();
    }
  });
});

describe("toggleHostExclusion", () => {
  it("adds the host when the checkbox turns on", async () => {
    await toggleHostExclusion("https://www.example.com/page", true);
    expect((await getSettings()).excludedDomains).toEqual(["www.example.com"]);
  });

  it("removes it again and leaves other patterns alone", async () => {
    await toggleHostExclusion("https://a.example.com/x", true);
    await toggleHostExclusion("https://b.example.com/x", true);
    await toggleHostExclusion("https://a.example.com/x", false);
    expect((await getSettings()).excludedDomains).toEqual(["b.example.com"]);
  });

  it("is idempotent", async () => {
    await toggleHostExclusion("https://www.example.com/", true);
    await toggleHostExclusion("https://www.example.com/", true);
    expect((await getSettings()).excludedDomains).toEqual(["www.example.com"]);
  });

  it("ignores chrome:// and other hostless URLs", async () => {
    await toggleHostExclusion("chrome://extensions", true);
    await toggleHostExclusion(undefined, true);
    expect((await getSettings()).excludedDomains).toEqual([]);
  });
});
