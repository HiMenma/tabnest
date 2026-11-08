# Changelog

All notable changes are recorded here. The format follows Keep a Changelog, and
versions follow semantic versioning.

## [1.2.1] — 2026-11-08

### Changed

- The sync page states the `chrome.storage.sync` precondition in the UI, above
  the quota hint: replication happens only while the browser profile is signed in
  to a Google account with sync on, and a signed-out profile looks identical from
  inside the extension.
- Three strings that were hard-coded in English now go through the catalogue: the
  details panel's accessible name, the quick-list toggle's tooltip, and the store
  id placeholder and hint.
- Both READMEs: the two screenshots taken from a real browsing session are gone,
  the remaining ones are scripted captures over sample data, and installing from
  a release archive is documented next to the source build.

### Fixed

- The documentation claimed 174 unit tests (142 in the review checklist); the
  suite has 178.

## [1.2.0] — 2026-11-08

### Added

- Deleting a list: a trash button appears on hover in the sidebar and next to
  the list heading, and the Delete key works on a focused sidebar row. Both put
  the list and everything inside it in the trash, where it can be restored.
- The trash now remembers where a record came from (`trashedFrom`), so restoring
  returns it to its own list instead of dumping it at the root. An explicit
  destination still wins; a deleted origin falls back to the root.

### Fixed

- Restoring several records into the same list could drop the last one, because
  the destination was re-read mid-loop and written back from a stale copy.

## [1.1.1] — 2026-11-08

### Added

- The list heading in the library is editable in place: click the title (or
  press F2 on it) to rename the current list. The sidebar entry follows, and
  system views — All lists, Quick list, Archive, Trash — keep a read-only title.

## [1.1.0] — 2026-11-08

### Added

- **Action menu** on the toolbar icon and on the page: every parking scope
  (window, tab group, highlighted selection, current tab, all but this, left,
  right, all windows), a per-site "never park this host" toggle that names the
  active host and shows its state, a submenu of the six most recent lists, and
  Help.
- The selection item lights up when two or more tabs are highlighted, which is
  Chrome's only signal for a tab-strip selection.
- `library.html?group=<id>` deep link, used by the recent-lists submenu.
- Help page: quick start, what can be parked, the shortcuts read live from
  `chrome.commands`, where the data lives.
- Sidebar list names are editable in place: double-click the name or press F2,
  Enter commits, Escape cancels.
- `menu-report` message: what the last menu rebuild installed, and any per-item
  errors, so a support question does not need a screenshot.

### Fixed

- The trash appeared in "recent lists" because it is stored as a folder; system
  containers are excluded. Found while verifying the menu in ego lite.

## [1.0.1] — 2026-11-08

### Fixed

- Typing or pasting into the excluded-domain box (and into the detail panel's
  title, URL and notes fields) then leaving it immediately saved the previous
  value, because the blur handler read React state that had not been committed
  yet. The handlers now read the control's own value.

### Verified

- Exercised in ego lite (Chromium 156) against the unpacked build: parking a
  selection, group naming and order, search, quick list, detail editing, archive,
  trash and restore, opening a record back into a tab, options persistence,
  excluded-domain enforcement, popup, text import and JSON export.

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
