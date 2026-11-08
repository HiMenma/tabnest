# Store listing copy

## Name

TabNest — Tab Manager

## Summary (132 characters max)

Park tabs into lists, folders and groups. Restore them later, and sync to a
storage backend you choose — no account required.

## Detailed description

**Your tabs, out of the way and easy to find again.**

TabNest turns a window full of tabs into a tidy list. Park a window, a tab group
or a single tab; the tabs close, and the records stay, organised in folders and
groups, searchable, and one keystroke away when you need them back.

**Built for big libraries.** The list is virtualised, so ten thousand records
scroll as smoothly as ten. Search matches titles, URLs, hosts and notes as you
type.

**Sync that answers to you.** Most tab managers force a choice between one
vendor's cloud and nothing at all. TabNest treats storage as a pluggable
backend:

- **Chrome sync storage** — zero setup, inside your own Chrome account.
- **WebDAV** — Nextcloud, Synology, 坚果云, or any WebDAV folder.
- **Custom endpoint** — seven HTTP routes; a hundred-line reference server is
  included, and it runs on a Cloudflare Worker or a spare machine.
- **GitHub Gist** — a private gist, with the token you provide.

Each device writes only its own keys, so a plain folder is enough — no database,
no coordination service. Conflicts resolve to the newest record; deletions are
remembered for 90 days so an offline machine cannot undo them.

**Encrypted by default off-device.** For every external backend, payloads are
sealed with AES-GCM using a key derived from your passphrase. The storage
operator sees ciphertext and timestamps, not your browsing.

**Nothing else.** No analytics, no accounts, no remote code, no selling of data.
Site icons come from Chrome's local cache, so no third party learns which URLs
you saved.

### Features

- Park this window, this tab group, your highlighted tabs, the current tab, or
  everything except it — from the toolbar menu, the popup or a shortcut
- A per-site "never park this host" switch right in the menu
- Left, right, grouped, pinned and excluded-domain rules
- Folders, window groups and nested tab groups, renameable and deletable from the heading or the sidebar
- Notes, ratings, quick list, archive, and a 90-day-safe trash
- Search across titles, URLs, hosts and notes
- Import from a URL list, JSON, bookmarks, or your reading list
- Export to JSON or a self-contained HTML page
- Optional sync to Chrome storage, WebDAV, a custom endpoint, or a Gist
- Keyboard shortcuts, context menus, and an omnibox keyword (`tn`)
- Light and dark themes, English and Chinese

## Permissions justified

- **tabs** — the feature is reading the URLs of tabs you choose to park.
- **storage / unlimitedStorage** — the library, and Chrome sync when selected.
- **activeTab, scripting** — only when you use "park this link" from the context
  menu, to read the link's label.
- **contextMenus, commands, alarms** — menus, shortcuts, weekly maintenance.
- **favicon** — local icons; no third-party icon service.
- **optional: tabGroups, bookmarks, readingList** — requested only when you turn
  those integrations on.
- **optional host access** — requested only for the sync endpoint you type in.

## Screenshots

In `docs/screenshots/`:

| File                   | Shows                          |
| ---------------------- | ------------------------------ |
| `library-en-light.png` | the library with a folder open |
| `library-en-dark.png`  | the same in dark mode          |
| `library-zh-light.png` | the Chinese interface          |
| `popup-en-light.png`   | parking the current window     |
| `options-en-light.png` | behaviour and capture rules    |
| `sync-en-light.png`    | backend selection and status   |

Regenerate with `pnpm build && pnpm shots`. The script seeds its own sample data,
so no real browsing session is photographed; keep it that way.

## Category and audience

Productivity → Tab manager. Single purpose: park and restore tabs, with optional
sync to a storage the user supplies.
