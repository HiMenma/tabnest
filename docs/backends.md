# Backend contract

Anything that can store and serve a few named blobs can back TabNest sync. This
is the whole contract — implement these routes and point the extension at your
base URL.

## Routes

All paths are relative to the **base URL** the user enters.

| Method   | Path                             | Body  | Response                                     |
| -------- | -------------------------------- | ----- | -------------------------------------------- |
| `GET`    | `{storeId}/meta.json`            | —     | `200` bytes, or `404`                        |
| `PUT`    | `{storeId}/meta.json`            | bytes | `2xx`                                        |
| `GET`    | `{storeId}/idx.json`             | —     | `200` bytes, or `404`                        |
| `PUT`    | `{storeId}/idx.json`             | bytes | `2xx`                                        |
| `GET`    | `{storeId}/d/{deviceId}/{seq}.c` | —     | `200` bytes, or `404`                        |
| `PUT`    | `{storeId}/d/{deviceId}/{seq}.c` | bytes | `2xx`                                        |
| `DELETE` | `{storeId}/d/{deviceId}/{seq}.c` | —     | `2xx` (`404` is acceptable)                  |
| `GET`    | `{storeId}/_list?prefix=d/`      | —     | `{"keys": ["{storeId}/d/…"]}`                |
| `HEAD`   | `{storeId}/`                     | —     | optional `x-tabnest-used`, `x-tabnest-quota` |

Semantics:

- **PUT is idempotent.** Overwriting with identical bytes is a contractually
  valid no-op.
- **GET of a missing key returns 404**, not an empty body.
- **No partial reads.** A chunk is either complete or absent.
- **Content is opaque.** The server must not parse, decompress, or rewrite bodies.
- `Content-Type` is not significant; the extension sends
  `application/octet-stream`.
- Sizes: `meta.json` and `idx.json` are small (well under 4 KB). Chunk objects are
  bounded by the backend's `maxBytes` capability — 5.6 KB for `chrome.storage.sync`,
  much larger for a real server.

### Why `_list` exists

The extension discovers chunks by listing. `idx.json` is a cache and is never
trusted for correctness; a backend that cannot list can still work by serving
`_list` from an index it maintains itself (or by turning on index-only mode,
which makes `idx.json` authoritative and loses the ability to recover from a
lost index).

## The `chrome-sync` backend

`chrome.storage.sync` is not a file store and not a Drive folder: it is Chrome
Sync's channel for extension data. It has four preconditions, all on the browser
side, and the extension cannot verify any of them:

1. the profile is signed in to a Google account;
2. sync is turned on for that account;
3. the "Extensions" data type is included in what sync covers;
4. Chrome is online — offline writes queue locally and flush later.

When any of 1–3 fails, Chrome's documentation says the area "behaves like
`storage.local`": `set()` resolves, `getBytesInUse()` counts against the same
quota, and the bytes land in that machine's profile only. Nothing reports an
error, and no API exposes sync state short of `identity.getProfileUserInfo()`,
which needs the `identity.email` permission and returns an empty result both
when sync is off and when the permission is missing. TabNest therefore shows a
hint next to the selector instead of pretending to know, and treats a second
device as the only proof.

Where the bytes are, on macOS (other platforms use the equivalent profile
directory):

```
<Profile>/Sync Extension Settings/<extension-id>/    the chunks this profile holds
<Profile>/Sync Data/                                Chrome's sync engine database
<Profile>/Local Extension Settings/<extension-id>/  storage.local, for contrast
```

`Sync Extension Settings` is a LevelDB, and each chunk key is the literal
`<storeId>/d/<deviceId>/<seq>.c` from the routes above — `strings` over its
`*.log` and `*.ldb` files shows exactly what this profile is holding. Signed out,
that directory is the end of the line for the data; signed in, the same records
are uploaded through Chrome Sync and `Sync Data` is where the engine keeps its
bookkeeping.

Extension settings are encrypted in transit. At rest they are readable by Google
unless the user set a custom sync passphrase. If that is not acceptable, use
passphrase mode — TabNest then encrypts payloads itself before they reach the
API — or another backend.

## Authentication

Either form is accepted; the extension sends whichever the user selected:

```
Authorization: Bearer <token>
Authorization: Basic <base64(user:password)>
```

Basic is what makes `user:password` work with WebDAV-style servers.

## CORS, and why it often does not matter

An extension with **host permission** for the endpoint bypasses CORS entirely.
Without that permission, the request is an ordinary cross-origin `fetch`, so the
server must answer the preflight:

```
access-control-allow-origin: *
access-control-allow-methods: GET,PUT,DELETE,HEAD,OPTIONS
access-control-allow-headers: authorization,content-type,x-tabnest-store
```

The reference `handler.mjs` sends those headers on every response, which is why
the end-to-end test needs no permission prompt.

## Reference implementation

`server/handler.mjs` is the whole server: ~100 lines, one `handle(request, kv,
{token})` function over a key/value store with `get / put / delete / list`.
`worker.js` binds it to Cloudflare KV; `node-server.mjs` binds it to a directory.
See `server/README.md`.

## Other deployments

### nginx on your own box

```nginx
location /tabnest/ {
    alias /srv/tabnest/;
    dav_methods PUT DELETE;
    create_full_put_path on;
    dav_access user:rw;
    auth_basic "tabnest";
    auth_basic_user_file /etc/nginx/.htpasswd;
}
```

You still need `_list`; a three-line `autoindex`-backed handler, or a tiny
function in front of the directory, covers it.

### S3 / R2 / OSS

Point the base URL at a bucket behind a small function that maps the routes. The
`_list` route maps onto one list-objects call. Presigned URLs are not enough on
their own, because the extension needs `PUT`, `GET`, `DELETE` and listing over
time.

### WebDAV built-ins

Nextcloud, ownCloud, Synology and 坚果云 work as-is: enter
`https://host/remote.php/dav/files/<user>/tabnest/` (Nextcloud) or the
equivalent, with Basic auth. That backend uses `PROPFIND` for listing, so it does
not need the `_list` route.

## Verifying your endpoint by hand

```bash
BASE=https://example.com/tabnest
TOKEN=...

curl -sf -X PUT "$BASE/demo/meta.json" -H "Authorization: Bearer $TOKEN" --data-binary '{}'
curl -sf "$BASE/demo/meta.json" -H "Authorization: Bearer $TOKEN"; echo
curl -sf -X PUT "$BASE/demo/d/dev1/1.c" -H "Authorization: Bearer $TOKEN" --data-binary 'x'
curl -sf "$BASE/demo/_list?prefix=d/" -H "Authorization: Bearer $TOKEN"; echo
curl -sf -X DELETE "$BASE/demo/d/dev1/1.c" -H "Authorization: Bearer $TOKEN"
```

If those five lines work, sync will work.

## What the extension will not do

- It will not retry a `4xx` forever. `401`/`403` moves the engine to
  `needs-attention` and stops writing.
- It will not invent keys outside `<storeId>/`.
- It will not call any domain the user did not type into the settings field.
