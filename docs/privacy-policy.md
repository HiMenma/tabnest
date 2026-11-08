# TabNest — Privacy Policy

Last updated: 2026-11-08

TabNest is a tab manager for Chrome. This policy describes exactly what the
extension does with your data. There is no TabNest account, and the project
operates no server of its own.

## What TabNest stores on your device

- The tabs you park: URL, title, host, optional notes and rating, and timestamps.
- The folder and group structure that organises them.
- Your settings, including the list of domains you excluded from capture.
- Bookkeeping for sync: a random device id, the backend you chose, and cursors.
- A passphrase-derived key, if you enabled encrypted sync, in the same local
  database.

This data lives in the browser's IndexedDB for the extension and never leaves the
device unless you turn on sync or export a file.

## What leaves the device, and only when you ask

- **Sync.** If you configure a backend, chunk payloads are written to that
  backend. With the Chrome backend, the data goes into your own Chrome account.
  With WebDAV, a custom endpoint, or a Gist, it goes wherever you pointed it.
- **Exports.** Files you download are created locally from your library.
- **Site icons.** Icons are rendered through Chrome's built-in favicon cache.
  TabNest does not contact any icon service, because doing so would reveal the
  host of every parked tab to that service.

Encryption is on by default for every external backend: chunks are sealed with
AES-GCM using a key derived from your passphrase with PBKDF2-SHA256. The storage
operator sees ciphertext, sizes, and timestamps — not titles or URLs.

## What TabNest never does

- No analytics, telemetry, crash reporting, or usage pings.
- No uninstall beacon.
- No remote code, no remotely loaded scripts, no `eval`.
- No selling, transferring, or sharing of user data.
- No use of your data for advertising, creditworthiness, or lending.

## Permissions and why they are needed

| Permission                              | Reason                                               | When                        |
| --------------------------------------- | ---------------------------------------------------- | --------------------------- |
| `tabs`                                  | reading the URLs and titles of the tabs you park     | install                     |
| `storage`, `unlimitedStorage`           | your library, and Chrome sync if selected            | install                     |
| `activeTab`, `scripting`                | reading a link's label when you use the context menu | on use                      |
| `contextMenus`, `commands`, `alarms`    | menus, shortcuts, scheduled maintenance              | install                     |
| `favicon`                               | local site icons, so no third party sees your URLs   | install                     |
| `tabGroups`, `bookmarks`, `readingList` | optional integrations                                | only when you enable them   |
| host access to one origin               | talking to a sync backend you configured             | only when you configure one |

## Retention and deletion

- Your library stays until you delete it. Deleting a record moves it to the trash;
  emptying the trash removes it permanently.
- Deletion markers are kept for 90 days so an offline device cannot resurrect a
  deleted record. They contain only the record id and a timestamp.
- Backups you download are files you own; deleting the backend configuration can
  also remove the remote copy.

## Contact

Open an issue in the project repository.
