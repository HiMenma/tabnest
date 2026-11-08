// Orchestrates the two-pass build:
//   1. Vite builds the four HTML entry points into dist/
//   2. Vite builds the service worker into dist/background.js
//   3. The manifest is written last, from scripts/manifest.mjs
//
// Two passes are needed because the service worker needs a deterministic,
// unhashed filename while pages want hashed assets.
import { build } from "vite";
import { buildManifest, writeManifest } from "./manifest.mjs";

const watch = process.argv.includes("--watch");
const mode = process.env.NODE_ENV ?? "production";

const report = (label) => ({
  name: `tabnest-${label}-report`,
  buildEnd() {
    console.log(`build: ${label} ${watch ? "(watching)" : "done"}`);
  },
});

console.log(`build: pages (mode=${mode})`);
await build({
  mode,
  build: watch ? { watch: {} } : {},
  plugins: [report("pages")],
});

console.log(`build: service worker (mode=${mode})`);
await build({
  mode,
  configFile: "vite.sw.config.ts",
  build: watch ? { watch: {} } : {},
  plugins: [report("worker")],
});

// In watch mode the manifest only needs writing once; the build scripts above
// keep the process alive.
writeManifest();

// Surface the permission set so a reviewer can see it without opening dist/.
const m = buildManifest();
console.log(`permissions: ${m.permissions.join(", ")}`);
console.log(`optional:    ${m.optional_permissions.join(", ")}`);
console.log(`optional host: ${m.optional_host_permissions.join(", ")}`);

if (!watch) console.log("build: ok -> dist/");
