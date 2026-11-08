# Pre-submission review checklist

Everything here is checkable with a command, so it stays true.

## Build and package

- [x] `pnpm build` produces `dist/` and loads unpacked without console errors
  (`pnpm smoke`).
- [x] `pnpm zip` produces an archive whose contents are exactly `dist/`.
- [x] `dist/` contains no `one-tab.com` and no third-party endpoint
  (`grep -RIn "one-tab\.com" dist/` is empty; CI enforces it).
- [x] No `eval`, `new Function`, `importScripts`, or remote script in `src/`.
- [x] Manifest is MV3, `service_worker` type `module`, CSP
  `script-src 'self'; object-src 'self'`.

## Permissions

- [x] `permissions` equals the reviewed allowlist (CI: `scripts/check-permissions.mjs`).
- [x] `host_permissions` is empty; host access is optional and requested per
  configured backend.
- [x] `optional_permissions` are only the three integrations the UI offers.
- [x] No `web_accessible_resources`, no `externally_connectable`.

## Privacy

- [x] No analytics SDK, no telemetry endpoint, no uninstall URL.
- [x] Icons come from Chrome's local `_favicon` API; no icon service is contacted.
- [x] Privacy policy text lives in `docs/privacy-policy.md` and matches the code.
- [x] Sync payloads are encrypted for every external backend.
- [x] Screenshots come from `pnpm shots` and its sample data; a real browsing
  session is never photographed.

## Accessibility

- [x] `pnpm a11y` reports zero violations on library, group view, options, sync,
  import and popup (axe-core, WCAG 2.1 A/AA).
- [x] Every interactive control is reachable by keyboard, with a visible focus ring.
- [x] Colour tokens pass AA contrast on both surfaces, including hover states.

## Behaviour

- [x] Parking is all-or-nothing: records commit before any tab closes.
- [x] A failed sync push never deletes local data; the engine pauses and reports.
- [x] Deletion is recoverable from the trash; tombstones expire after 90 days.
- [x] Sync converges under concurrent edits (13-case conflict matrix in tests).

## Tests

- [x] `pnpm test` — unit suite, 178 cases.
- [x] `pnpm smoke` — real Chromium, parking round trip, 5 000-record scale,
  chrome.storage.sync backend.
- [x] `pnpm e2e:sync` — two Chromium profiles, one server, encrypted replication.
- [x] `pnpm a11y` — axe over six surfaces.

## Listing

- [x] Copy in `docs/store-listing.md`, screenshots in `docs/screenshots/`.
- [x] Single purpose: park and restore tabs, with optional user-supplied sync.
- [x] Permission justifications written out.

## Versioning

- [x] Semantic version in `package.json`; the manifest reads it.
- [x] `CHANGELOG.md` describes what changed.
- [x] Tag the release commit.
- [x] A GitHub release carries the packaged zip (`pnpm zip`).

## Known limitations, disclosed

- Sync is not live: the worker wakes on a timer, so a change can take up to a
  minute to reach another device when no TabNest page is open.
- `chrome.storage.sync` holds roughly 100 KB, about 1500–2500 tabs. Beyond that
  the engine pauses rather than truncate, and the UI says so.
- Losing both the passphrase and the recovery material makes the remote copy
  unreadable — by design.
