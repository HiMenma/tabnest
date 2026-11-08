import { describe, expect, it } from "vitest";
import {
  canonicalizeUrl,
  fallbackTitle,
  hashToId,
  hostMatchesPattern,
  hostOf,
  isExcludedHost,
  isParkable,
  isTooLong,
  normalizeTitle,
  urlId,
} from "../../src/data/url";

describe("isParkable", () => {
  it("accepts web and file URLs", () => {
    expect(isParkable("https://example.com/a")).toBe(true);
    expect(isParkable("http://example.com")).toBe(true);
    expect(isParkable("file:///Users/me/notes.md")).toBe(true);
  });

  it("rejects browser internals and nonsense", () => {
    for (const url of [
      "chrome://extensions",
      "chrome-extension://abc/pages/library.html",
      "about:blank",
      "devtools://devtools/bundled/inspector.html",
      "view-source:https://example.com",
      "javascript:alert(1)",
      "not a url",
      "",
    ]) {
      expect(isParkable(url), url).toBe(false);
    }
  });
});

describe("canonicalizeUrl", () => {
  it("drops tracking parameters", () => {
    expect(canonicalizeUrl("https://example.com/p?utm_source=x&utm_medium=y&id=7")).toBe(
      "https://example.com/p?id=7",
    );
    expect(canonicalizeUrl("https://example.com/p?gclid=abc&fbclid=def")).toBe(
      "https://example.com/p",
    );
    expect(canonicalizeUrl("https://example.com/p?spm=a1z.2&page=2")).toBe(
      "https://example.com/p?page=2",
    );
  });

  it("keeps parameters that select content", () => {
    const canonical = canonicalizeUrl("https://example.com/search?q=cats&page=2");
    expect(canonical).toBe("https://example.com/search?q=cats&page=2");
  });

  it("reduces search result pages to their query", () => {
    expect(
      canonicalizeUrl("https://www.google.com/search?q=tabs&sca_esv=deadbeef&ved=2ahU&oq=tabs"),
    ).toBe("https://www.google.com/search?q=tabs");
    expect(canonicalizeUrl("https://www.bing.com/search?q=tabs&form=QBLH&first=2")).toBe(
      "https://www.bing.com/search?q=tabs&first=2",
    );
    expect(canonicalizeUrl("https://duckduckgo.com/?q=tabs&ia=web&t=ffab")).toBe(
      "https://duckduckgo.com/?q=tabs&ia=web",
    );
    expect(canonicalizeUrl("https://www.baidu.com/s?wd=tabs&rsv_spt=1&ie=utf-8")).toBe(
      "https://www.baidu.com/s?wd=tabs",
    );
  });

  it("keeps route fragments and drops anchors", () => {
    expect(canonicalizeUrl("https://example.com/app#/issues/42")).toBe(
      "https://example.com/app#/issues/42",
    );
    expect(canonicalizeUrl("https://example.com/doc#section-3")).toBe("https://example.com/doc");
  });

  it("normalises the authority", () => {
    expect(canonicalizeUrl("HTTPS://Example.COM/Path")).toBe("https://example.com/Path");
    expect(canonicalizeUrl("https://example.com:443/x")).toBe("https://example.com/x");
    expect(canonicalizeUrl("https://example.com")).toBe("https://example.com/");
  });

  it("collapses data URLs to their media type", () => {
    expect(canonicalizeUrl("data:image/png;base64,AAAA")).toBe("data:image/png");
    expect(canonicalizeUrl("data:text/html,<b>x</b>")).toBe("data:text/html");
  });

  it("returns null for things it cannot store", () => {
    expect(canonicalizeUrl("chrome://settings")).toBeNull();
    expect(canonicalizeUrl("nonsense")).toBeNull();
  });

  it("is idempotent", () => {
    const once = canonicalizeUrl("https://example.com/a?utm_source=1&b=2#/x");
    expect(once).not.toBeNull();
    expect(canonicalizeUrl(once as string)).toBe(once);
  });
});

describe("isTooLong", () => {
  it("quarantines absurd URLs only", () => {
    expect(isTooLong(`https://example.com/${"a".repeat(100)}`)).toBe(false);
    expect(isTooLong(`https://example.com/${"a".repeat(70_000)}`)).toBe(true);
  });
});

describe("urlId", () => {
  it("is 22 characters from the id alphabet", async () => {
    const id = await urlId("https://example.com/");
    expect(id).toHaveLength(22);
    expect(id).toMatch(/^[0-9A-Za-z_-]{22}$/);
  });

  it("is stable and collision-free for different URLs", async () => {
    const a = await urlId("https://example.com/a");
    const b = await urlId("https://example.com/a");
    const c = await urlId("https://example.com/b");
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it("derives the same id from equivalent canonical URLs", async () => {
    const one = canonicalizeUrl("https://example.com/p?utm_source=news") as string;
    const two = canonicalizeUrl("https://example.com/p") as string;
    expect(await urlId(one)).toBe(await urlId(two));
  });
});

describe("hashToId", () => {
  it("encodes 132 bits into 22 characters", () => {
    const bytes = new Uint8Array(32).fill(0xff);
    const id = hashToId(bytes);
    expect(id).toHaveLength(22);
    expect(id).toMatch(/^[0-9A-Za-z_-]{22}$/);
  });
});

describe("hosts", () => {
  it("extracts lowercased hosts", () => {
    expect(hostOf("https://Example.COM/a")).toBe("example.com");
    expect(hostOf("chrome://settings")).toBe("");
  });

  it("matches exclusion patterns including wildcards", () => {
    expect(hostMatchesPattern("mail.google.com", "google.com")).toBe(true);
    expect(hostMatchesPattern("mail.google.com", "*.google.com")).toBe(true);
    expect(hostMatchesPattern("notgoogle.com", "google.com")).toBe(false);
    expect(hostMatchesPattern("example.com", "")).toBe(false);
  });

  it("honours the exclusion list", () => {
    const list = ["bank.example", "*.corp.internal"];
    expect(isExcludedHost("bank.example", list)).toBe(true);
    expect(isExcludedHost("vpn.corp.internal", list)).toBe(true);
    expect(isExcludedHost("example.com", list)).toBe(false);
  });
});

describe("titles", () => {
  it("falls back to a readable label", () => {
    expect(fallbackTitle("https://example.com/blog/hello-world")).toBe("example.com — hello-world");
    expect(fallbackTitle("https://example.com/")).toBe("example.com");
  });

  it("collapses whitespace and caps length", () => {
    expect(normalizeTitle("  lots   of\n space ", "https://example.com")).toBe("lots of space");
    expect(normalizeTitle(undefined, "https://example.com/x")).toBe("example.com — x");
    expect(normalizeTitle("x".repeat(900), "https://example.com")).toHaveLength(500);
  });
});
