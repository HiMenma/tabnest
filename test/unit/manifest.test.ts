import { describe, expect, it } from "vitest";
import {
  buildManifest,
  OPTIONAL_HOST_PERMISSIONS,
  OPTIONAL_PERMISSIONS,
  PERMISSIONS,
} from "../../scripts/manifest.mjs";

type Manifest = {
  manifest_version: number;
  version: string;
  name: string;
  description: string;
  icons: Record<string, string>;
  action: { default_popup: string; default_icon: Record<string, string> };
  options_ui: { page: string };
  background: { service_worker: string; type?: string };
  permissions: string[];
  optional_permissions: string[];
  optional_host_permissions: string[];
  host_permissions?: string[];
  update_url?: string;
  commands: Record<string, unknown>;
  omnibox: { keyword: string };
  content_security_policy: { extension_pages: string };
};

const manifest = buildManifest() as Manifest;

describe("manifest", () => {
  it("is MV3 with a module service worker", () => {
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.background.service_worker).toBe("background.js");
    expect(manifest.background.type).toBe("module");
  });

  it("declares the reviewed permission allowlist", () => {
    expect([...manifest.permissions].sort()).toEqual([...PERMISSIONS].sort());
    expect([...manifest.optional_permissions].sort()).toEqual([...OPTIONAL_PERMISSIONS].sort());
    expect([...manifest.optional_host_permissions].sort()).toEqual(
      [...OPTIONAL_HOST_PERMISSIONS].sort(),
    );
  });

  it("never asks for host access at install time", () => {
    expect(manifest.host_permissions ?? []).toEqual([]);
  });

  it("is self-hosted: no update_url, no remote script in the CSP", () => {
    expect(manifest.update_url).toBeUndefined();
    const csp = manifest.content_security_policy.extension_pages;
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toMatch(/https?:\/\//);
  });

  it("points every entry point at a file the build produces", () => {
    expect(manifest.action.default_popup).toBe("pages/popup.html");
    expect(manifest.options_ui.page).toBe("pages/options.html");
    for (const path of Object.values(manifest.icons)) {
      expect(path).toMatch(/^icons\/icon\d+\.png$/);
    }
  });

  it("binds all parking commands and an omnibox keyword", () => {
    expect(Object.keys(manifest.commands)).toEqual(
      expect.arrayContaining([
        "display-library",
        "park-current-tab",
        "park-window",
        "park-tab-group",
        "park-all-except-current",
        "park-left",
        "park-right",
        "park-all-windows",
      ]),
    );
    expect(manifest.omnibox.keyword).toBe("tn");
  });
});
