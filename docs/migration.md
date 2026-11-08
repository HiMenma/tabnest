# Migration from another tab manager

TabNest has no relationship with, and speaks no API of, any other tab manager.
This page covers the only migration paths that exist: **files you already own**.

## 1. Plain URL list (works with almost everything)

Most tab managers can copy their lists to the clipboard or export a text file.
Paste or import it — the importer accepts one URL per line, optionally prefixed
by a title:

```
https://example.com/article
Some title	https://example.com/other
- https://example.com/third
```

Rules applied on import:

- Lines that do not contain a parseable `http(s)` URL are skipped and counted.
- A title is taken from the text before the URL when it is separated by a tab or
  `-`; otherwise the URL is used until the real title can be fetched.
- Duplicates collapse onto the same record (content-derived id), so importing the
  same file twice is harmless.
- Every imported list becomes one group labelled `Imported <date>` unless the
  file carries its own structure.

## 2. JSON exports

A generic shape is accepted, and the importer will also walk a few common ones
automatically:

```jsonc
// flat list
[{ "url": "https://example.com", "title": "Example" }]

// nested by list
[{ "title": "Reading", "tabs": [{ "url": "…", "title": "…" }] }]
```

If your export uses a different shape, the import dialog shows the fields it
found and lets you map them. Unknown fields are preserved in the record's notes
rather than dropped.

## 3. Bookmarks

`chrome.bookmarks.getTree()` is read directly when the user grants the optional
`bookmarks` permission. The importer can either

- create one group _per bookmark folder_ (default), or
- flatten the whole tree into a single list.

Folder dates are used as `createdAt` so the list sorts where you expect.

## 4. Reading list

The optional `readingList` permission exposes `chrome.readingList.query()`.
Entries import with their read/unread state mapped to `archivedAt`, sorted by
creation time.

## What is deliberately not supported

- **No account connection, no OAuth to another vendor, no scraping of anyone's
  share pages.** If it requires talking to a service we do not own, it is out of
  scope — both for legal reasons and because it would put a third party in the
  middle of your browsing history.
- **No automatic discovery of another extension's local database.** Extension
  storage is origin-isolated; reaching into it would be a security bug, not a
  feature. Use that extension's own export function.

## After migrating

1. Open the library, check the imported groups.
2. Configure sync (see `docs/sync-design.md`) and run one manual sync so the
   first snapshot is written.
3. Keep the export file until you have seen the same library on a second device.
