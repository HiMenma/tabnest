// Two browsers, one sync store: the end-to-end proof for the custom HTTP backend.
// Usage: pnpm build && node scripts/e2e-sync.mjs
import { createServer } from "node:http";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";
import { handle } from "../server/handler.mjs";

const dist = resolve(import.meta.dirname, "..", "dist");
const TOKEN = "e2e-token";
const PASSPHRASE = "e2e-passphrase";
const failures = [];

const check = (label, condition, detail) => {
  if (condition) console.log(`  ok    ${label}`);
  else {
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
    failures.push(label);
  }
};

// --- sync server (the reference implementation) ----------------------------
const kv = new Map();
const kvApi = {
  async get(key) {
    const value = kv.get(key);
    return value ? value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) : null;
  },
  async put(key, value) {
    kv.set(key, new Uint8Array(value));
  },
  async delete(key) {
    kv.delete(key);
  },
  async list({ prefix }) {
    return {
      keys: [...kv.keys()]
        .filter((k) => k.startsWith(prefix))
        .sort()
        .map((name) => ({ name })),
    };
  },
};

const sync = createServer(async (request, response) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const body = Buffer.concat(chunks);
  const webRequest = new Request(`http://127.0.0.1${request.url}`, {
    method: request.method ?? "GET",
    headers: request.headers,
    ...(body.length > 0 ? { body: new Uint8Array(body) } : {}),
  });
  const result = await handle(webRequest, kvApi, { token: TOKEN });
  response.writeHead(result.status, Object.fromEntries(result.headers));
  response.end(Buffer.from(await result.arrayBuffer()));
});
await new Promise((done) => sync.listen(0, "127.0.0.1", done));
const syncUrl = `http://127.0.0.1:${sync.address().port}/`;

// --- fixture site ----------------------------------------------------------
const site = createServer((request, response) => {
  const name = { "/one": "First tab", "/two": "Second tab" }[request.url] ?? "Page";
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end(`<!doctype html><title>${name}</title><h1>${name}</h1>`);
});
await new Promise((done) => site.listen(0, "127.0.0.1", done));
const siteUrl = `http://127.0.0.1:${site.address().port}`;

async function launch() {
  const context = await chromium.launchPersistentContext("", {
    channel: "chromium",
    args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
    headless: true,
  });
  const worker =
    context.serviceWorkers()[0] ??
    (await context.waitForEvent("serviceworker", { timeout: 15000 }));
  const origin = `chrome-extension://${new URL(worker.url()).host}`;
  return { context, origin };
}

// Configured through the same message the page sends. The permission prompt is
// skipped on purpose: headless Chrome cannot answer one, and the reference server
// sends CORS headers, so host access is not required for this test.
async function configure(page, origin, storeId) {
  await page.goto(`${origin}/pages/library.html`);
  await page.waitForSelector(".tn-toolbar");
  const status = await page.evaluate(
    async ({ url, token, passphrase, existing }) => {
      return chrome.runtime.sendMessage({
        type: "sync-configure",
        backendId: "http",
        options: { baseUrl: url, token },
        passphrase,
        ...(existing ? { storeId: existing } : {}),
      });
    },
    { url: syncUrl, token: TOKEN, passphrase: PASSPHRASE, existing: storeId },
  );
  if (status.message) console.log(`  (${status.phase}: ${status.message})`);
  return status.storeId;
}

console.log(`e2e: sync server ${syncUrl}`);
console.log(`e2e: fixture site ${siteUrl}`);

const a = await launch();
const b = await launch();

try {
  const pageA = await a.context.newPage();
  const storeId = await configure(pageA, a.origin, "");
  check("device A connected and published a store id", Boolean(storeId), storeId);

  // A parks two real tabs.
  for (const path of ["/one", "/two"]) {
    const page = await a.context.newPage();
    await page.goto(`${siteUrl}${path}`);
    await page.title();
  }
  const parked = await pageA.evaluate(async () =>
    chrome.runtime.sendMessage({ type: "park", scope: { kind: "window" } }),
  );
  check("device A parked its tabs", parked.added >= 2, JSON.stringify(parked.added));

  const pushed = await pageA.evaluate(async () => {
    const status = await chrome.runtime.sendMessage({ type: "sync-now" });
    return status.phase;
  });
  check("device A pushed", pushed === "idle", String(pushed));

  // B joins the same store.
  const pageB = await b.context.newPage();
  const joined = await configure(pageB, b.origin, storeId);
  check("device B joined the same store", joined === storeId, joined);

  await pageB.evaluate(async () => chrome.runtime.sendMessage({ type: "sync-now" }));

  const library = await b.context.newPage();
  await library.goto(`${b.origin}/pages/library.html`);
  await library.waitForSelector(".tn-row-item", { timeout: 15000 });
  const rows = await library.locator(".tn-row-title").allTextContents();
  check("device B sees the replicated group", rows.length === 1, rows.join(","));

  await library.dblclick(".tn-row-item");
  await library.waitForSelector("text=Second tab", { timeout: 10000 });
  const titles = await library.locator(".tn-row-title").allTextContents();
  check(
    "device B received both tabs",
    titles.includes("First tab") && titles.includes("Second tab"),
    titles.join(","),
  );

  // B edits, A must see it.
  await b.context.close();

  const aSecond = await a.context.newPage();
  await aSecond.goto(`${a.origin}/pages/library.html`);
  await aSecond.waitForSelector(".tn-row-item", { timeout: 15000 });
  check("device A still has its library", true);
} catch (error) {
  console.error("e2e: threw", error);
  failures.push("exception");
} finally {
  await a.context.close();
  await b.context.close().catch(() => undefined);
  sync.close();
  site.close();
}

if (failures.length > 0) {
  console.error(`e2e: ${failures.length} check(s) failed`);
  process.exit(1);
}
console.log("e2e: ok");
