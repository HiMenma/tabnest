# Changelog

All notable changes are recorded here. The format follows Keep a Changelog, and
versions follow semantic versioning.

## [1.0.0] — 2026-11-08

First complete release.

### Added

- **Parking**: eight scopes (this window, current tab group, current tab,
  everything except this, left, right, all windows, a selection), with pinned-tab,
  excluded-domain, duplicate and tab-group policies.
- **Library**: folder and window-group tree, nested Chrome tab groups, quick list,
  archive, trash, virtualised list, search over titles/URLs/hosts/notes,
  multi-select, drag and drop, inline rename, notes and star ratings.
- **Sync**: journal-based replication with per-device key prefixes, last-write-wins
  per record with a serialisation tie-break, tombstones with a 90-day TTL, chunk
  compaction, a quota guard that pauses instead of truncating, and optional
  AES-GCM encryption (PBKDF2-SHA256, AAD-bound chunks).
- **Backends**: Chrome `storage.sync`, WebDAV, a custom HTTP endpoint, and GitHub
  Gist, all behind one object-store interface; backup download and restore for any
  configured store.
- **Reference server**: `server/` with a Cloudflare Worker entry point, a
  directory-backed Node server, and the contract in `docs/backends.md`.
- **Import/export**: URL lists, JSON (including nested shapes), bookmarks, reading
  list; export to versioned JSON or a self-contained HTML page.
- **Surrounding**: keyboard commands, context menus, omnibox keyword, options page,
  light/dark themes via `light-dark()`, English and Chinese localisation.
- **Quality**: 142 unit tests, a Chromium smoke test with a 5 000-record scale
  check, a two-profile sync end-to-end test, and an axe accessibility audit with
  zero violations.

### Known limitations

- Sync wakes on a timer, so propagation can take up to a minute when no TabNest
  page is open.
- `chrome.storage.sync` caps the library at roughly 1500–2500 tabs.
- No "publish as a web page" feature; export to HTML is the supported path.
