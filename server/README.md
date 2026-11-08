# TabNest sync server

A complete implementation of the custom HTTP backend: about 100 lines, one
key/value store, no database, no coordination.

## Routes

| Method   | Path                            | Meaning                                                |
| -------- | ------------------------------- | ------------------------------------------------------ |
| `GET`    | `/{storeId}/{rest…}`            | read a blob, `404` when absent                         |
| `PUT`    | `/{storeId}/{rest…}`            | write a blob (idempotent)                              |
| `DELETE` | `/{storeId}/{rest…}`            | remove a blob                                          |
| `GET`    | `/{storeId}/_list?prefix=<rel>` | `{"keys": ["<storeId>/<rel>/…"]}`                      |
| `HEAD`   | `/{storeId}/`                   | optional: `x-tabnest-used` / `x-tabnest-quota` headers |

Auth is a single shared secret, sent as `Authorization: Bearer <token>` (or
`Basic` with `token` base64-encoded, which is what the extension does when you
pick "Basic" so that `user:password` works).

Bodies are opaque: the server never parses, decompresses, or rewrites them.

## Run it locally

```bash
TN_TOKEN=secret TN_DIR=./data node server/node-server.mjs --port 8787
```

Then in TabNest → Sync: backend **Custom endpoint**, URL
`http://127.0.0.1:8787/`, token `secret`. Because `chrome.permissions.request`
needs a real click, grant host access when the browser asks — or rely on the
server's CORS headers, which the reference sends.

## Deploy to Cloudflare Workers

```toml
# wrangler.toml
name = "tabnest-sync"
main = "worker.js"
compatibility_date = "2026-01-01"

kv_namespaces = [{ binding = "TN", id = "<namespace id>" }]
```

```bash
wrangler kv namespace create TN     # paste the id above
wrangler secret put TN_TOKEN        # the shared secret
wrangler deploy
```

## Anywhere else

The storage only needs four operations, so a directory (as in
`node-server.mjs`), S3 behind a small function, or a table in your favourite
database all work. Implement `get / put / delete / list({prefix})` and pass them
to `handle()` from `handler.mjs`.

## What the server can see

Keys, sizes, timings, and the store id. With a passphrase configured in the
extension, bodies are AES-GCM ciphertext, and the server cannot read titles or
URLs — the chunk's position is bound into the AAD, so it cannot even reorder
them without breaking decryption.
