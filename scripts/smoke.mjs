// Loads the built extension in a real Chromium and drives a full parking round
// trip. This is the automated half of the M1/M2 gate; run `pnpm build && pnpm smoke`.
import { createServer } from "node:http";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";

const dist = resolve(import.meta.dirname, "..", "dist");
const failures = [];

const check = (label, condition, detail) => {
  if (condition) {
    console.log(`  ok    ${label}`);
  } else {
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
    failures.push(label);
  }
};

// A tiny site so parked tabs have real http(s) URLs and real titles.
const site = createServer((request, response) => {
  const name = { "/alpha": "Alpha", "/beta": "Beta", "/gamma": "Gamma" }[request.url] ?? "Page";
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end(`<!doctype html><title>${name}</title><h1>${name}</h1>`);
});
await new Promise((done) => site.listen(0, "127.0.0.1", done));
const port = site.address().port;
const base = `http://127.0.0.1:${port}`;

console.log(`smoke: loading ${dist}`);
console.log(`smoke: serving fixtures at ${base}`);
const context = await chromium.launchPersistentContext("", {
  channel: "chromium",
  args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
  headless: true,
});

try {
  const worker =
    context.serviceWorkers()[0] ??
    (await context.waitForEvent("serviceworker", { timeout: 15000 }));
  // chrome-extension:// is not a special scheme, so URL.origin is "null".
  const origin = `chrome-extension://${new URL(worker.url()).host}`;
  console.log(`smoke: worker ${worker.url()}`);

  const manifest = await worker.evaluate(() => chrome.runtime.getManifest());
  check("manifest is MV3", manifest.manifest_version === 3, String(manifest.manifest_version));
  check("worker has the tab permission", manifest.permissions?.includes("tabs"));
  check("no update_url", !manifest.update_url);

  // --- pages render -------------------------------------------------------
  // Selectors, not copy: the UI is localised to the host's language.
  for (const [path, selector] of [
    ["pages/library.html", ".tn-toolbar"],
    ["pages/options.html", ".tn-page"],
    ["pages/import.html", ".tn-page"],
    ["pages/sync.html", ".tn-page"],
  ]) {
    const page = await context.newPage();
    await page.goto(`${origin}/${path}`);
    await page.waitForSelector(selector, { timeout: 10000 });
    check(`${path} renders`, true);
    await page.close();
  }

  const popup = await context.newPage();
  await popup.goto(`${origin}/pages/popup.html`);
  await popup.waitForSelector(".tn-popup-actions", { timeout: 10000 });
  const popupCount = (await popup.textContent(".tn-popup-count")) ?? "";
  check("popup rendered its window summary", popupCount.length > 0, popupCount.trim());
  await popup.close();

  // --- parking round trip -------------------------------------------------
  const library = await context.newPage();
  await library.goto(`${origin}/pages/library.html`);
  await library.waitForSelector(".tn-list-empty", { timeout: 10000 });

  for (const path of ["/alpha", "/beta", "/gamma"]) {
    const page = await context.newPage();
    await page.goto(`${base}${path}`);
    await page.title();
  }

  const outcome = await library.evaluate(async () => {
    const reply = await chrome.runtime.sendMessage({
      type: "park",
      scope: { kind: "window" },
    });
    return reply;
  });
  check("park reported three tabs", outcome?.added === 3, JSON.stringify(outcome));
  check("park closed the tabs", outcome?.closedTabs === 3, String(outcome?.closedTabs));

  // The page picks the change up from the worker broadcast. Root lists groups,
  // so the parked window appears as one group holding three tabs.
  await library.waitForSelector(".tn-row-item", { timeout: 10000 });
  const rootRows = await library.locator(".tn-row-title").allTextContents();
  check("parking created one group at root", rootRows.length === 1, rootRows.join(","));
  check("the group is named after its first tab", rootRows[0] === "Alpha", rootRows[0]);

  await library.dblclick(".tn-row-item");
  await library.waitForSelector("text=Beta", { timeout: 10000 });
  const rowCount = await library.locator(".tn-row-item").count();
  check("the group holds the three parked tabs", rowCount === 3, `saw ${rowCount} rows`);

  const order = await library.locator(".tn-row-title").allTextContents();
  check("tab-strip order is preserved", order.join(",") === "Alpha,Beta,Gamma", order.join(","));

  // --- search -------------------------------------------------------------
  await library.fill(".tn-search", "bet");
  await library.waitForFunction(
    () => document.querySelectorAll(".tn-row-item").length === 1,
    undefined,
    { timeout: 5000 },
  );
  const hits = await library.locator(".tn-row-item").count();
  check("search narrows to one row", hits === 1, `saw ${hits}`);
  await library.fill(".tn-search", "");

  // --- quick list + trash through the worker ------------------------------
  const stats = await library.evaluate(async () => {
    const snapshot = await chrome.runtime.sendMessage({ type: "snapshot" });
    const tab = snapshot.nodes.find((node) => node.kind === "tab");
    await chrome.runtime.sendMessage({ type: "quick-list", id: tab.id, member: true });
    const after = await chrome.runtime.sendMessage({ type: "snapshot" });
    const quick = after.nodes.find((node) => node.id === "quickList");
    await chrome.runtime.sendMessage({ type: "delete", ids: [tab.id], mode: "trash" });
    const trashed = await chrome.runtime.sendMessage({ type: "snapshot" });
    const trash = trashed.nodes.find((node) => node.id === "trash");
    return {
      tabs: after.nodes.filter((node) => node.kind === "tab").length,
      quick: quick.children.length,
      inTrash: trash.children.includes(tab.id),
      total: trashed.nodes.length,
    };
  });
  check("snapshot exposes three tabs", stats.tabs === 3, String(stats.tabs));
  check("quick list accepts a member", stats.quick === 1, String(stats.quick));
  check("trash receives a deleted tab", stats.inTrash === true);

  // --- sync: chrome.storage.sync as the default backend -------------------
  const syncResult = await library.evaluate(async () => {
    const configured = await chrome.runtime.sendMessage({
      type: "sync-configure",
      backendId: "chrome-sync",
    });
    const afterFirst = await chrome.runtime.sendMessage({ type: "sync-now" });
    const stored = await chrome.storage.sync.get(null);
    const keys = Object.keys(stored);
    const afterSecond = await chrome.runtime.sendMessage({ type: "sync-now" });
    const storedAgain = await chrome.storage.sync.get(null);
    return {
      phase: configured.phase,
      storeId: configured.storeId,
      chunkKeys: keys.filter((key) => key.includes("/d/")).length,
      chunkKeysAfterIdleSync: Object.keys(storedAgain).filter((key) => key.includes("/d/")).length,
      queuedAfterSync: afterFirst.queued,
      bytes: keys.reduce((sum, key) => sum + String(stored[key]).length, 0),
      secondPhase: afterSecond.phase,
    };
  });
  check("sync turns on", syncResult.phase === "idle", String(syncResult.phase));
  check("chunks reached chrome.storage.sync", syncResult.chunkKeys > 0, `${syncResult.chunkKeys}`);
  check("sync drains the queue", syncResult.queuedAfterSync === 0, `${syncResult.queuedAfterSync}`);
  check(
    "an idle sync writes nothing new",
    syncResult.chunkKeysAfterIdleSync === syncResult.chunkKeys,
    `${syncResult.chunkKeys} -> ${syncResult.chunkKeysAfterIdleSync}`,
  );

  // --- scale: 5000 records ------------------------------------------------
  const bulk = await library.evaluate(async (fixturePort) => {
    const items = Array.from({ length: 5000 }, (_, index) => ({
      url: `http://127.0.0.1:${fixturePort}/bulk/${index}`,
      title: `Bulk item ${index}`,
    }));
    const started = performance.now();
    const result = await chrome.runtime.sendMessage({ type: "import", items, label: "Bulk" });
    return { ...result, ms: Math.round(performance.now() - started) };
  }, port);
  check(
    "imports 5000 records",
    bulk.added === 5000,
    JSON.stringify({ added: bulk.added, ms: bulk.ms }),
  );
  check("import completes promptly", bulk.ms < 8000, `${bulk.ms} ms`);

  await library.waitForSelector("text=Bulk", { timeout: 15000 });
  await library.dblclick("text=Bulk");
  await library.waitForSelector(".tn-row-item", { timeout: 15000 });
  const domRows = await library.locator(".tn-row-item").count();
  check("virtual list keeps the DOM small", domRows > 0 && domRows < 120, `${domRows} rows in DOM`);

  const searchMs = await library.evaluate(async () => {
    const input = document.querySelector(".tn-search");
    const started = performance.now();
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(input, "Bulk item 4999");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    while (document.querySelectorAll(".tn-row-item").length !== 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
      if (performance.now() - started > 2000) break;
    }
    return Math.round(performance.now() - started);
  });
  check("search over 5000 rows is quick", searchMs < 300, `${searchMs} ms`);
  const searchRows = await library.locator(".tn-row-item").count();
  check("search finds the single match", searchRows === 1, `${searchRows} rows`);

  await library.fill(".tn-search", "");
  await library.waitForSelector("text=Bulk", { timeout: 5000 });

  // --- persistence across a reload ---------------------------------------
  const countTabsNow = () =>
    library.evaluate(async () => {
      const snapshot = await chrome.runtime.sendMessage({ type: "snapshot" });
      return {
        tabs: snapshot.nodes.filter((node) => node.kind === "tab").length,
        trash: snapshot.nodes.find((node) => node.id === "trash").children.length,
      };
    });

  const beforeReload = await countTabsNow();
  await library.reload();
  await library.waitForSelector(".tn-row-item", { timeout: 10000 });
  const afterReload = await countTabsNow();
  check(
    "the library survives a reload",
    afterReload.tabs === beforeReload.tabs,
    `${beforeReload.tabs} -> ${afterReload.tabs}`,
  );
  check("the trash entry survives a reload", afterReload.trash === 1, String(afterReload.trash));
} catch (error) {
  console.error("smoke: threw", error);
  failures.push("exception");
} finally {
  await context.close();
  site.close();
}

if (failures.length > 0) {
  console.error(`smoke: ${failures.length} check(s) failed`);
  process.exit(1);
}
console.log("smoke: ok");
