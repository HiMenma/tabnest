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
