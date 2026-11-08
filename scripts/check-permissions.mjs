// CI guard: the manifest's permission surface is a product decision, not an
// implementation detail. This fails when it drifts from the reviewed allowlist.
import {
  buildManifest,
  OPTIONAL_HOST_PERMISSIONS,
  OPTIONAL_PERMISSIONS,
  PERMISSIONS,
} from "./manifest.mjs";

const manifest = buildManifest();

const EXPECTED = {
  permissions: PERMISSIONS,
  optional_permissions: OPTIONAL_PERMISSIONS,
  optional_host_permissions: OPTIONAL_HOST_PERMISSIONS,
};

let failed = false;

const same = (a, b) => a.length === b.length && [...a].sort().join() === [...b].sort().join();

for (const [key, expected] of Object.entries(EXPECTED)) {
  const actual = manifest[key] ?? [];
  if (!same(actual, expected)) {
    console.error(`permissions: ${key} drifted`);
    console.error(`  expected: ${JSON.stringify(expected)}`);
    console.error(`  actual:   ${JSON.stringify(actual)}`);
    failed = true;
  } else {
    console.log(`permissions: ${key} ok (${actual.length})`);
  }
}

const hostPermissions = manifest.host_permissions ?? [];
if (hostPermissions.length > 0) {
  console.error("permissions: host_permissions must stay empty; use optional_host_permissions");
  failed = true;
}

if (manifest.update_url) {
  console.error("permissions: update_url must not be declared");
  failed = true;
}

const csp = manifest.content_security_policy?.extension_pages ?? "";
if (!csp.includes("script-src 'self'")) {
  console.error(`permissions: unexpected CSP ${JSON.stringify(csp)}`);
  failed = true;
}

process.exit(failed ? 1 : 0);
