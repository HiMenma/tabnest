# Privacy

Short version: **the library stays on the machine unless you turn sync on, and
then it goes only where you point it.** There is no TabNest server, no account,
no analytics endpoint, and no remote code.

## What is stored locally

| Data                                                                    | Where                      | Why                   |
| ----------------------------------------------------------------------- | -------------------------- | --------------------- |
| Parked tabs: URL, title, host, notes, rating, timestamps                | IndexedDB `tabnest`        | the product itself    |
| Group/folder structure and order                                        | IndexedDB `tabnest`        | the product itself    |
| Settings, including the excluded-domain list                            | IndexedDB `meta`           | user preferences      |
| Device id, sync backend configuration, cursors, diagnostics ring buffer | IndexedDB `meta`           | sync bookkeeping      |
| Passphrase-derived key                                                  | service-worker memory only | never written to disk |

Parked URLs are the sensitive part: they are a history of intent. They are not
sent anywhere, hashed or otherwise, unless sync or export is used.

## What leaves the device, and only on purpose

| Path                  | Trigger                  | What is sent                                             | Encrypted                                                                    |
| --------------------- | ------------------------ | -------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Chosen sync backend   | sync enabled by the user | chunk payloads, `storeId`, `deviceId`, `seq`, timestamps | passphrase mode for every external backend; off by default for `chrome-sync` |
| `chrome.storage.sync` | user picks that backend  | same, inside the user's own Google account               | optional                                                                     |
| Export file           | user clicks export       | whatever the user chose to export                        | optional                                                                     |
| Site icons            | rendering a list row     | **nothing** — Chrome's local `_favicon` API              | n/a                                                                          |

Explicitly **not** done:

- no analytics, crash reporting, or "usage" ping of any kind;
- no uninstall beacon;
- no third-party icon service (a favicon API would leak the host of every parked
  tab to that service);
- no remote configuration and no remotely loaded script; the CSP is
  `script-src 'self'`.

## Per-backend reality check

- **`chrome.storage.sync`** — data lives in the user's Google account and is
  encrypted in transit by Chrome. Google can read it; the sync page says so in
  those words. Use passphrase mode if that is not acceptable, or another backend.
- **WebDAV / custom HTTP / Gist** — the operator of that storage sees chunk sizes
  and timings, and with the `storeId`/`deviceId` can correlate devices. Content is
  AES-GCM encrypted with a key derived from a passphrase the operator never sees.
  Metadata is not hidden: this is end-to-end for _content_, not for _traffic
  analysis_.
- **Local file** — nothing leaves the machine at all.

## Retention

- Local library: until the user deletes it. The trash is emptied by the user,
  not by a timer.
- Tombstones: 90 days, then garbage collected (this is what stops an offline
  device resurrecting deletions).
- Remote chunks: until the owning device compacts them; a snapshot replaces its
  predecessors. Deleting the backend configuration offers to delete the remote
  copy as well.
- Diagnostics ring buffer: capped, and cleared by the user from the sync page.

## Permissions, justified

`tabs` is the load-bearing one: parking requires reading the URL and title of
every tab in a window. It is what the product is for, and it is requested at
install because there is no way to do this work without it.

Everything narrower is optional and requested when used: `tabGroups`,
`bookmarks`, `readingList`, and host access for a user-configured sync endpoint.
Nothing is requested for arbitrary websites at install time; grabbing a link's
title for the context-menu action uses `activeTab` only.

## For the Chrome Web Store listing

- Single purpose: park and restore tabs, plus optional sync to a user-supplied
  store.
- No data sold, transferred, or used for purposes unrelated to the single
  purpose; no data used to determine creditworthiness.
- No human reads user data; nobody _can_ — there is no service to read it on.
