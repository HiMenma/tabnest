// Builds dist/manifest.json. Kept in code (not JSON) so permissions and entry
// points are reviewable in one place and can react to the build environment.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");

export function readVersion() {
  const pkg = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8"));
  return /** @type {{ version: string }} */ (pkg).version;
}

/** The full permission surface, in one place, for CI to diff against. */
export const PERMISSIONS = [
  "tabs",
  "storage",
  "unlimitedStorage",
  "activeTab",
  "scripting",
  "contextMenus",
  "alarms",
  "favicon",
];

export const OPTIONAL_PERMISSIONS = ["tabGroups", "bookmarks", "readingList"];

/** Requested at runtime, only when the user configures an external sync backend. */
export const OPTIONAL_HOST_PERMISSIONS = ["https://*/*", "http://*/*"];

const COMMANDS = {
  "display-library": {
    suggested_key: { default: "Alt+Shift+1" },
    description: "Open the TabNest library",
  },
  "park-current-tab": { description: "Park the current tab" },
  "park-window": { description: "Park all tabs in this window" },
  "park-tab-group": { description: "Park all tabs in the current tab group" },
  "park-all-except-current": { description: "Park all tabs except this one" },
  "park-left": { description: "Park all tabs to the left" },
  "park-right": { description: "Park all tabs to the right" },
  "park-all-windows": { description: "Park all tabs in all windows" },
};

export function buildManifest() {
  const version = readVersion();
  return {
    manifest_version: 3,
    name: "TabNest",
    description: "Park tabs into lists, folders and groups. Sync to a backend you choose.",
    version,
    minimum_chrome_version: "120",

    icons: {
      16: "icons/icon16.png",
      32: "icons/icon32.png",
      48: "icons/icon48.png",
      128: "icons/icon128.png",
    },

    action: {
      default_title: "TabNest",
      default_popup: "pages/popup.html",
      default_icon: {
        16: "icons/icon16.png",
        32: "icons/icon32.png",
      },
    },

    options_ui: {
      page: "pages/options.html",
      open_in_tab: true,
    },

    background: {
      service_worker: "background.js",
      type: "module",
    },

    permissions: PERMISSIONS,
    optional_permissions: OPTIONAL_PERMISSIONS,
    optional_host_permissions: OPTIONAL_HOST_PERMISSIONS,

    commands: COMMANDS,

    omnibox: { keyword: "tn" },

    content_security_policy: {
      extension_pages: "script-src 'self'; object-src 'self'; img-src 'self' data:",
    },
  };
}

export function writeManifest() {
  const dir = resolve(ROOT, "dist");
  mkdirSync(dir, { recursive: true });
  const manifest = buildManifest();
  writeFileSync(resolve(dir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`manifest: dist/manifest.json (v${manifest.version})`);
  return manifest;
}

if (import.meta.filename === process.argv[1]) writeManifest();
