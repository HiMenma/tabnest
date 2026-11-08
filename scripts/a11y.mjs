// Accessibility audit over every surface, using axe-core against the real build.
// Usage: pnpm build && node scripts/a11y.mjs
import { resolve } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { chromium } from "@playwright/test";

const dist = resolve(import.meta.dirname, "..", "dist");
const context = await chromium.launchPersistentContext("", {
  channel: "chromium",
  args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
  headless: true,
  viewport: { width: 1240, height: 820 },
});

let failures = 0;

try {
  const worker =
    context.serviceWorkers()[0] ??
    (await context.waitForEvent("serviceworker", { timeout: 15000 }));
  const origin = `chrome-extension://${new URL(worker.url()).host}`;

  const seed = await context.newPage();
  await seed.goto(`${origin}/pages/library.html`);
  await seed.waitForSelector(".tn-toolbar");
  await seed.evaluate(async () => {
    await chrome.runtime.sendMessage({
      type: "import",
      label: "Reading list",
      items: [
        { url: "https://developer.chrome.com/docs/extensions", title: "Extensions" },
        { url: "https://web.dev/articles/storage-for-the-web", title: "Storage for the web" },
      ],
    });
  });
  await seed.waitForTimeout(300);

  const surfaces = [
    { name: "library", path: "pages/library.html", ready: ".tn-toolbar" },
    { name: "library (group)", path: "pages/library.html", ready: ".tn-toolbar", enter: true },
    { name: "options", path: "pages/options.html", ready: ".tn-section" },
    { name: "sync", path: "pages/sync.html", ready: ".tn-page" },
    { name: "import", path: "pages/import.html", ready: ".tn-section" },
  ];

  for (const surface of surfaces) {
    const page = await context.newPage();
    await page.goto(`${origin}/${surface.path}`);
    await page.waitForSelector(surface.ready, { timeout: 10000 });
    if (surface.enter) {
      await page.dblclick(".tn-row-item");
      await page.waitForTimeout(200);
    }

    const result = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();

    const violations = result.violations;
    if (violations.length === 0) {
      console.log(`  ok    ${surface.name}: no violations`);
    } else {
      failures += violations.length;
      console.log(`  FAIL  ${surface.name}: ${violations.length} rule(s)`);
      for (const violation of violations) {
        console.log(`          ${violation.id} (${violation.impact}) — ${violation.help}`);
        for (const node of violation.nodes.slice(0, 3)) {
          console.log(`            ${node.target.join(" ")}`);
        }
      }
    }
    await page.close();
  }

  // The popup has its own document, so it gets its own entry.
  const popup = await context.newPage();
  await popup.setViewportSize({ width: 360, height: 460 });
  await popup.goto(`${origin}/pages/popup.html`);
  await popup.waitForSelector(".tn-popup-actions");
  const popupResult = await new AxeBuilder({ page: popup })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  if (popupResult.violations.length === 0) {
    console.log("  ok    popup: no violations");
  } else {
    failures += popupResult.violations.length;
    console.log(`  FAIL  popup: ${popupResult.violations.length} rule(s)`);
    for (const violation of popupResult.violations) {
      console.log(`          ${violation.id} (${violation.impact}) — ${violation.help}`);
      for (const node of violation.nodes.slice(0, 3))
        console.log(`            ${node.target.join(" ")}`);
    }
  }
  await popup.close();
} catch (error) {
  console.error("a11y: threw", error);
  failures += 1;
} finally {
  await context.close();
}

if (failures > 0) {
  console.error(`a11y: ${failures} violation(s)`);
  process.exit(1);
}
console.log("a11y: ok");
