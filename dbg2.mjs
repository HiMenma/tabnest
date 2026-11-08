import { createServer } from "node:http";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";

const dist = resolve(process.cwd(), "dist");
const site = createServer((q, s) => {
  s.writeHead(200, { "content-type": "text/html" });
  s.end("<title>x</title>");
});
await new Promise((d) => site.listen(0, "127.0.0.1", d));
const ctx = await chromium.launchPersistentContext("", {
  channel: "chromium",
  args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
  headless: true,
});
const w = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent("serviceworker"));
const origin = `chrome-extension://${new URL(w.url()).host}`;
const page = await ctx.newPage();
page.on("console", (m) => console.log("console:", m.type(), m.text().slice(0, 200)));
await page.goto(origin + "/pages/sync.html");
await page.waitForSelector("select[name=backend]");
await page.selectOption("select[name=backend]", "http");
await page.fill("input[name=baseUrl]", "http://127.0.0.1:1/");
await page.fill("input[name=token]", "t");
await page.fill("input[name=passphrase]", "p");
// probe permission behaviour in this environment
const granted = await page.evaluate(async () => {
  try {
    return await chrome.permissions.request({ origins: ["http://127.0.0.1/*"] });
  } catch (e) {
    return "throw: " + e.message;
  }
});
console.log("permission request result:", granted);
await page.click("button:has-text('Turn on sync')");
await page.waitForTimeout(1500);
console.log("error text:", await page.textContent(".tn-sync-error").catch(() => "(none)"));
console.log("buttons:", await page.locator("button").allTextContents());
await ctx.close();
site.close();
