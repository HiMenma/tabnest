# Roadmap

Each milestone ends with `pnpm lint && pnpm typecheck && pnpm test` green and a
tag. Gates exist so scope cannot drift: a milestone is done when its acceptance
items pass, not when the code "mostly works".

## M0 — Scaffold ✅

- [x] Repository, licence, clean-room notice
- [x] Vite + TypeScript + Biome, two-pass build (pages, then worker)
- [x] Manifest generated from code; permission allowlist enforced in CI
- [x] Icons generated from code (`scripts/gen-icons.mjs`), no binary art
- [x] Four pages and the worker loading; typed ping round trip
- [x] CI: lint, typecheck, unit tests, build, forbidden-string check, zip

**Gate:** `pnpm build` produces a `dist/` that loads unpacked, the popup shows
`worker v0.1.0`, and `dist/` contains no third-party endpoint.

## M1 — Data layer and capture ✅

- [x] `idb.ts` schema v1 with migration hook
- [x] `model.ts` invariants + `repo.ts` mutations in single transactions
- [x] `url-rules.ts` + canonicalisation and dedupe tests
- [x] Eight parking actions, pinned/excluded/duplicate/tab-group rules
- [x] Quarantine for oversized URLs

**Gate:** park 50 tabs → records and tab-strip order match; parking twice does
not duplicate; a crash between commit and close leaves no half state.

## M2 — Library UI ✅

- [x] Tree with folders, window groups, tab groups, quick list, trash
- [x] Virtual list, search, multi-select, drag and drop, inline edit
- [x] Open strategies: same tab, new tab, new window; restore as group
- [x] Notes and ratings

**Gate:** 5000 records render under 300 ms; search under 50 ms; keyboard-only
navigation works.

## M3 — Surrounding features ✅

- [x] Popup chooser, options page, import/export (text, JSON, bookmarks, reading list)
- [x] Keyboard commands, context menus, omnibox
- [x] i18n: en + zh-CN
- [x] Archive and trash lifecycle, retention sweep

**Gate:** import of a 500-entry export produces the expected structure; every
command in the manifest does something.

## M4 — Sync engine and the default backend ✅

- [x] Journal, codec, crypto, quota guard, device identity
- [x] `chrome-sync` backend with batching and backoff
- [x] Conflict rules from `docs/sync-design.md`, with the 8-case test matrix
- [x] Status surface, diagnostics export, badge
- [x] Two-instance end-to-end test against the in-memory backend

**Gate:** A adds/edits/moves/deletes → B converges within 5 s; overflow enters
`paused:too-large` with local data intact.

## M5 — External backends ✅

- [x] `http`, `webdav`, `gist`, `file` behind the same `ObjectStore`
- [x] Configuration UI with runtime host-permission requests
- [x] `server/worker.js` reference implementation + docs
- [x] Passphrase flow, recovery code, "forgot passphrase" expectations

**Gate:** a real WebDAV directory and a deployed worker both round-trip a
two-device sync; wrong passphrase fails loudly and never corrupts local data.

## M6 — Store readiness ✅

- [x] Performance pass, accessibility pass, dark mode audit
- [x] Privacy policy page, listing copy, screenshots
- [x] Versioning policy and changelog
- [x] Review checklist: permissions, CSP, no remote code, single purpose

**Gate:** a fresh Chrome profile can install the zip, park tabs, sync to a
WebDAV folder, and restore on a second profile.

## Deliberately later

- Tab discarding on restore (v1.1)
- Structure-only sync mode (designed, behind a flag)
- Team libraries (would need a real service; out of scope)
