# TabNest

A Chrome tab manager: park your open tabs into lists, organise the lists into
folders and groups, find them again by search, and restore them later — with
**your choice of sync backend** and optional end‑to‑end encryption.

> Status: **M0 (scaffold)**. The extension loads and the build pipeline works;
> data layer and UI land in M1–M3, sync in M4–M5. See `docs/roadmap.md`.

## Why another tab manager

The interesting part is the sync layer. Most tab managers make you pick one
vendor's cloud, or none. TabNest treats storage as a pluggable object store:

| Backend                 | Config needed                                  | Capacity         | Encryption    |
| ----------------------- | ---------------------------------------------- | ---------------- | ------------- |
| `chrome-sync` (default) | none — uses your Chrome profile                | ~100 KB          | optional      |
| `webdav`                | URL + user/pass (Nextcloud, 坚果云, Synology…) | your disk quota  | on by default |
| `http`                  | any endpoint implementing 7 verb-ish routes    | whatever you run | on by default |
| `gist`                  | a GitHub token                                 | 1 MB per file    | on by default |
| `file`                  | none                                           | unlimited        | on by default |

Each device only ever writes its own key prefix, so no locking service is
required: a dumb object store, a Cloudflare Worker, or a WebDAV folder all work.

See `docs/sync-design.md` for the protocol and `docs/backends.md` for the
custom-endpoint contract.

## Quick start

```bash
pnpm install
pnpm icons        # generate PNG icons from code (no binary art in the repo)
pnpm build        # -> dist/
```

Then open `chrome://extensions`, enable Developer mode, "Load unpacked", and
pick `dist/`.

```bash
pnpm typecheck    # tsc --noEmit
pnpm lint         # biome check
pnpm test         # vitest
pnpm smoke        # loads dist/ in a real Chromium and asserts it works
pnpm e2e          # playwright (needs: npx playwright install chromium)
pnpm zip          # store-ready archive
```

`pnpm smoke` is the automated half of the "does it actually load" gate: it
launches Chromium with the unpacked build, reads the manifest from the service
worker, renders each page and checks the page ↔ worker channel.

## Layout

```
pages/            HTML entry points (library, popup, options, sync)
src/background/   service worker: capture rules, messaging, sync engine
src/data/         IndexedDB schema, repository, URL canonicalisation
src/ui/           React pages + shared components + design tokens
src/i18n/         UI strings
scripts/          build pipeline, manifest generation, icon generation
server/           reference implementation for the custom HTTP backend
docs/             architecture, sync protocol, backend contract, privacy
test/             unit (vitest) and e2e (playwright)
```

## Permissions, and why

| Permission                              | Reason                                                               |
| --------------------------------------- | -------------------------------------------------------------------- |
| `tabs`                                  | reading the URLs/titles of the tabs you park — the core feature      |
| `storage`, `unlimitedStorage`           | local library, and `chrome.storage.sync` when chosen as backend      |
| `activeTab`, `scripting`                | grabbing a link's title only when you invoke the context menu item   |
| `contextMenus`, `commands`, `alarms`    | the menu entries, keyboard shortcuts, scheduled sync                 |
| `favicon`                               | local site icons built into Chrome, so no third party sees your URLs |
| `tabGroups`, `bookmarks`, `readingList` | **optional**, requested only when you use those features             |
| `https://*/*`, `http://*/*`             | **optional**, requested only when you point sync at your own server  |

No analytics, no telemetry, no remote code.

## Licence

MIT — see `LICENSE`. `NOTICE.md` documents the clean-room provenance.
