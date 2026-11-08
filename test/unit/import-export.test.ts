import { describe, expect, it } from "vitest";
import type { Group, LibrarySnapshot, TabItem } from "../../src/data/model";
import { collectGroups, countItems, toExportDocument, toHtml } from "../../src/ui/data/export";
import { dedupe, flattenBookmarks, parseJson, parseText } from "../../src/ui/data/import";

function tab(id: string, url: string, title: string): TabItem {
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

function group(id: string, label: string, children: string[], parents: string[]): Group {
  return {
    id,
    kind: "group",
    groupType: "folder",
    label,
    children,
    parents,
    createdAt: 1,
    updatedAt: 1,
  };
}

describe("parseText", () => {
  it("reads one URL per line", () => {
    const items = parseText("https://a.example/1\nhttps://b.example/2");
    expect(items.map((item) => item.url)).toEqual(["https://a.example/1", "https://b.example/2"]);
  });

  it("takes a title from either side of the URL", () => {
    expect(parseText("Some title\thttps://a.example/x")[0]).toEqual({
      url: "https://a.example/x",
      title: "Some title",
    });
    expect(parseText("https://a.example/x  Some title")[0]).toEqual({
      url: "https://a.example/x",
      title: "Some title",
    });
    expect(parseText("- https://a.example/x")[0]?.url).toBe("https://a.example/x");
  });

  it("strips trailing punctuation", () => {
    expect(parseText("See https://a.example/x.")[0]?.url).toBe("https://a.example/x");
    expect(parseText("(https://a.example/x)")[0]?.url).toBe("https://a.example/x");
  });

  it("ignores lines without a URL", () => {
    expect(parseText("just some prose\n\nhttps://a.example/x")).toHaveLength(1);
    expect(parseText("")).toEqual([]);
  });
});

describe("parseJson", () => {
  it("reads a flat array", () => {
    const items = parseJson('[{"url":"https://a.example/1","title":"A"}]');
    expect(items).toEqual([{ url: "https://a.example/1", title: "A" }]);
  });

  it("walks nested group shapes", () => {
    const items = parseJson(
      JSON.stringify([
        {
          title: "Reading",
          tabs: [{ url: "https://a.example/1" }, { url: "https://a.example/2" }],
        },
        { title: "Later", items: [{ url: "https://b.example/1" }] },
      ]),
    );
    expect(items.map((item) => item.url)).toEqual([
      "https://a.example/1",
      "https://a.example/2",
      "https://b.example/1",
    ]);
  });

  it("reads this project's own export format", () => {
    const document = {
      format: "tabnest-export",
      version: 1,
      groups: [{ label: "A", path: ["All lists"], items: [{ url: "https://a.example/x" }] }],
    };
    expect(parseJson(JSON.stringify(document))).toHaveLength(1);
  });

  it("returns nothing for malformed input", () => {
    expect(parseJson("{not json")).toEqual([]);
    expect(parseJson('"a string"')).toEqual([]);
  });
});

describe("dedupe", () => {
  it("keeps the first occurrence", () => {
    const items = dedupe([
      { url: "https://a.example/1", title: "first" },
      { url: "https://a.example/1", title: "second" },
      { url: "https://a.example/2" },
    ]);
    expect(items.map((item) => item.title ?? item.url)).toEqual(["first", "https://a.example/2"]);
  });
});

describe("flattenBookmarks", () => {
  it("walks folders depth first and skips folder rows", () => {
    const tree = [
      {
        id: "0",
        title: "root",
        children: [
          {
            id: "1",
            title: "Work",
            children: [{ id: "2", title: "Doc", url: "https://work.example/a" }],
          },
          { id: "3", title: "Loose", url: "https://loose.example/b" },
        ],
      },
    ] as unknown as chrome.bookmarks.BookmarkTreeNode[];

    expect(flattenBookmarks(tree)).toEqual([
      { url: "https://work.example/a", title: "Doc" },
      { url: "https://loose.example/b", title: "Loose" },
    ]);
  });
});

describe("export", () => {
  const snapshot: LibrarySnapshot = {
    settings: {
      pinned: "ignore",
      excludedDomains: [],
      alreadyParked: "skip",
      tabGroups: "respect",
      closeAfter: "window",
      openIn: "tab",
      theme: "auto",
    },
    stats: { tabs: 2, groups: 1, folders: 1, total: 3, quarantined: 0 },
    nodes: [
      group("root", "All lists", ["g1"], []),
      group("g1", "Reading", ["t1", "t2"], ["root"]),
      { ...tab("t1", "https://a.example/1", "A <b>"), parents: ["g1"] },
      { ...tab("t2", "https://b.example/2", "B"), parents: ["g1"], notes: "keep", rating: 3 },
    ],
  };

  it("groups tabs under their folder path", () => {
    const groups = collectGroups(snapshot);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.label).toBe("Reading");
    expect(groups[0]?.path).toEqual(["All lists", "Reading"]);
    expect(groups[0]?.items).toHaveLength(2);
    expect(groups[0]?.items[1]).toMatchObject({ notes: "keep", rating: 3 });
    expect(countItems(groups)).toBe(2);
  });

  it("writes a versioned document", () => {
    const document = toExportDocument(snapshot);
    expect(document.format).toBe("tabnest-export");
    expect(document.version).toBe(1);
    expect(document.exportedAt).toBeGreaterThan(0);
  });

  it("escapes HTML in titles and notes", () => {
    const html = toHtml(snapshot);
    expect(html).toContain("&lt;b&gt;");
    expect(html).not.toContain("<b>");
    expect(html).toContain("<title>TabNest library");
    expect(html).toContain("keep");
    // Inert by construction: no script tag anywhere.
    expect(html.toLowerCase()).not.toContain("<script");
  });
});
