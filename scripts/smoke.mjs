// Loads the built extension in a real Chromium and asserts the basics work.
// This is the automated half of the M0 gate; run `pnpm build && pnpm smoke`.
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

console.log(`smoke: loading ${dist}`);
// `channel: "chromium"` is required: the default headless shell cannot load
// extensions, and the full browser in new-headless mode can.
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

  // The typed page <-> worker bus, exercised the way a user triggers it.
  const pages = [
    { path: "pages/library.html", anchor: "All lists" },
    { path: "pages/options.html", anchor: "Options" },
    { path: "pages/sync.html", anchor: "Backends" },
  ];

  for (const { path, anchor } of pages) {
    const page = await context.newPage();
    await page.goto(`${origin}/${path}`);
    await page.waitForSelector(`text=${anchor}`, { timeout: 10000 });
    check(`${path} renders "${anchor}"`, true);
    await page.close();
  }

  // The ping round trip, exercised from a page the way a user would trigger it.
  const popup = await context.newPage();
  await popup.goto(`${origin}/pages/popup.html`);
  const pill = await popup.waitForSelector(".tn-pill", { timeout: 10000 });
  const pillText = (await pill.textContent()) ?? "";
  check("popup reached the worker", /worker v\d/.test(pillText), pillText.trim());
  await popup.close();
} catch (error) {
  console.error("smoke: threw", error);
  failures.push("exception");
} finally {
  await context.close();
}

if (failures.length > 0) {
  console.error(`smoke: ${failures.length} check(s) failed`);
  process.exit(1);
}
console.log("smoke: ok");
