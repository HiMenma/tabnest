// Renders the surfaces with representative data and writes PNGs to docs/screenshots/.
// Used for review and for the store listing, so it runs against the real build.
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";

const root = resolve(import.meta.dirname, "..");
const dist = resolve(root, "dist");
const outDir = resolve(root, "docs", "screenshots");
mkdirSync(outDir, { recursive: true });

const SAMPLE = [
  {
    label: "Reading list",
    items: [
      [
        "https://developer.chrome.com/docs/extensions/develop/concepts/service-workers",
        "Extension service workers",
      ],
      ["https://web.dev/articles/storage-for-the-web", "Storage for the web"],
      ["https://www.w3.org/TR/wai-aria-1.2/", "WAI-ARIA 1.2"],
      ["https://vite.dev/guide/", "Vite guide"],
      ["https://www.typescriptlang.org/docs/handbook/2/narrowing.html", "Narrowing — TypeScript"],
    ],
  },
  {
    label: "Research — sync protocols",
    items: [
      ["https://www.rfc-editor.org/rfc/rfc4918", "RFC 4918 — WebDAV"],
      ["https://datatracker.ietf.org/doc/html/rfc6902", "RFC 6902 — JSON Patch"],
      ["https://crdt.tech/", "CRDT resources"],
      ["https://www.inkandswitch.com/local-first/", "Local-first software"],
    ],
  },
  {
    label: "Later",
    items: [
      ["https://github.com/GoogleChrome/chrome-extensions-samples", "Chrome extension samples"],
      ["https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API", "IndexedDB API — MDN"],
      ["https://sqlite.org/withoutrowid.html", "WITHOUT ROWID — SQLite"],
    ],
  },
];

async function seed(page) {
  for (const group of SAMPLE) {
    await page.evaluate(
      async (payload) => {
        await chrome.runtime.sendMessage({
          type: "import",
          label: payload.label,
          items: payload.items.map(([url, title]) => ({ url, title })),
        });
      },
      { label: group.label, items: group.items },
    );
  }
}

async function shoot({ locale, scheme, suffix }) {
  const context = await chromium.launchPersistentContext("", {
    channel: "chromium",
    args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
    headless: true,
    locale,
    colorScheme: scheme,
    viewport: { width: 1240, height: 780 },
    deviceScaleFactor: 2,
  });

  try {
    const worker =
      context.serviceWorkers()[0] ??
      (await context.waitForEvent("serviceworker", { timeout: 15000 }));
    const origin = `chrome-extension://${new URL(worker.url()).host}`;

    const library = await context.newPage();
    await library.goto(`${origin}/pages/library.html`);
    await library.waitForSelector(".tn-toolbar", { timeout: 10000 });
    await seed(library);
    await library.waitForTimeout(400);
    await library.dblclick("text=Reading list");
    await library.waitForSelector(".tn-row-item", { timeout: 5000 });
    await library.hover(".tn-row-item");
    await library.waitForTimeout(300);
    await library.screenshot({ path: resolve(outDir, `library-${suffix}.png`) });
    console.log(`screenshots: library-${suffix}.png`);

    if (suffix === "en-light") {
      const popup = await context.newPage();
      await popup.setViewportSize({ width: 360, height: 460 });
      await popup.goto(`${origin}/pages/popup.html`);
      await popup.waitForSelector(".tn-popup-actions", { timeout: 5000 });
      await popup.screenshot({ path: resolve(outDir, "popup-en-light.png") });
      console.log("screenshots: popup-en-light.png");

      const options = await context.newPage();
      await options.goto(`${origin}/pages/options.html`);
      await options.waitForSelector(".tn-section", { timeout: 5000 });
      await options.screenshot({ path: resolve(outDir, "options-en-light.png"), fullPage: true });
      console.log("screenshots: options-en-light.png");

      const io = await context.newPage();
      await io.goto(`${origin}/pages/import.html`);
      await io.waitForSelector(".tn-section", { timeout: 5000 });
      await io.screenshot({ path: resolve(outDir, "import-en-light.png"), fullPage: true });
      console.log("screenshots: import-en-light.png");

      const sync = await context.newPage();
      await sync.goto(`${origin}/pages/sync.html`);
      await sync.waitForSelector(".tn-section", { timeout: 5000 });
      await sync.screenshot({ path: resolve(outDir, "sync-en-light.png"), fullPage: true });
      console.log("screenshots: sync-en-light.png");
    }
  } finally {
    await context.close();
  }
}

await shoot({ locale: "en-US", scheme: "light", suffix: "en-light" });
await shoot({ locale: "en-US", scheme: "dark", suffix: "en-dark" });
await shoot({ locale: "zh-CN", scheme: "light", suffix: "zh-light" });
