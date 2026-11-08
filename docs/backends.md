# Backend contract

Anything that can store and serve a few named blobs can back TabNest sync. This
document is the whole contract — implement these routes and point the extension
at your base URL.

## Routes

All paths are relative to the **base URL** the user enters.

| Method   | Path                             | Body  | Response                         |
| -------- | -------------------------------- | ----- | -------------------------------- |
| `GET`    | `{storeId}/meta.json`            | —     | `200` bytes, or `404`            |
| `PUT`    | `{storeId}/meta.json`            | bytes | `2xx`                            |
| `GET`    | `{storeId}/idx.json`             | —     | `200` bytes, or `404`            |
| `PUT`    | `{storeId}/idx.json`             | bytes | `2xx`                            |
| `GET`    | `{storeId}/d/{deviceId}/{seq}.c` | —     | `200` bytes, or `404`            |
| `PUT`    | `{storeId}/d/{deviceId}/{seq}.c` | bytes | `2xx`                            |
| `DELETE` | `{storeId}/d/{deviceId}/{seq}.c` | —     | `2xx` (also `404` is acceptable) |

Semantics:

- **PUT is idempotent.** Overwriting with identical bytes is a no-op contractually.
- **GET of a missing key returns 404**, not an empty body.
- **No partial reads.** A chunk is either complete or absent.
- **Content is opaque.** The server must not parse, decompress, or rewrite bodies.
- `Content-Type` is not significant; the extension sends
  `application/octet-stream`.
- Sizes: `meta.json` and `idx.json` are small (well under 4 KB). Chunks are
  bounded by the backend's `maxBytes` capability, 5.5 KB raw by default.

### Listing

The extension prefers to discover chunks by listing `{storeId}/d/{deviceId}/`.
If your storage cannot list (plain S3 without `ListBucket`, for example), enable
the extension's "index-only mode": it will trust `idx.json` for discovery and
never call `list`. In that mode a lost `idx.json` is unrecoverable, so keep
versioning on.

## Authentication

Either form is accepted; the extension sends whichever the user configured:

```
Authorization: Bearer <token>
Authorization: Basic <base64(user:pass)>
```

Optional additional header supported for odd setups:

```
X-TabNest-Store: <storeId>
```

## Reference implementation

`server/worker.js` is a complete implementation on a Cloudflare Worker with KV,
about sixty lines. Deploy, set `TN_TOKEN`, and use the worker URL as the base.

Rough shape:

```js
export default {
  async fetch(req, env) {
    if (req.headers.get("Authorization") !== `Bearer ${env.TN_TOKEN}`) {
      return new Response("unauthorized", { status: 401 });
    }
    const key = new URL(req.url).pathname.replace(/^\/+/, "");
    if (!key || key.includes("..")) return new Response("bad key", { status: 400 });

    if (req.method === "GET") {
      const body = await env.TN.get(key, { type: "arrayBuffer" });
      return body ? new Response(body) : new Response("not found", { status: 404 });
    }
    if (req.method === "PUT") {
      await env.TN.put(key, await req.arrayBuffer());
      return new Response("ok");
    }
    if (req.method === "DELETE") {
      await env.TN.delete(key);
      return new Response("ok");
    }
    if (req.method === "PROPFIND" || req.method === "LIST") {
      const prefix = key.replace(/\/$/, "");
      const list = await env.TN.list({ prefix: `${prefix}/` });
      return Response.json({ keys: list.keys.map((k) => k.name) });
    }
    return new Response("method not allowed", { status: 405 });
  },
};
```

## Other deployments

### nginx on your own box

```nginx
location /tabnest/ {
    alias /srv/tabnest/;
    dav_methods PUT DELETE;
    create_full_put_path on;
    dav_access user:rw;
    autoindex on;                       # lets the extension use PROPFIND-free listing
    auth_basic "tabnest";
    auth_basic_user_file /etc/nginx/.htpasswd;
}
```

### S3 / R2 / OSS

Use a bucket with a path prefix and leave `idx.json`/index-only mode on, or put a
tiny function in front that answers the listing route. Presigned URLs are not
enough on their own, because the extension needs `PUT`, `GET` and `DELETE` over
time.

### WebDAV built-ins

Nextcloud, ownCloud, Synology, and 坚果云 all work as-is: enter
`https://host/remote.php/dav/files/<user>/tabnest/` (Nextcloud) or the
equivalent, with Basic auth.

## Verifying your endpoint by hand

```bash
BASE=https://example.com/tabnest
TOKEN=...

curl -sf -X PUT "$BASE/demo/meta.json" -H "Authorization: Bearer $TOKEN" --data-binary '{}'
curl -sf "$BASE/demo/meta.json" -H "Authorization: Bearer $TOKEN"; echo
curl -sf -X PUT "$BASE/demo/d/dev1/1.c" -H "Authorization: Bearer $TOKEN" --data-binary 'x'
curl -sf -X DELETE "$BASE/demo/d/dev1/1.c" -H "Authorization: Bearer $TOKEN"
```

If those five lines work, sync will work.

## What the extension will not do

- It will not retry a `4xx` forever. `401`/`403` moves the engine to
  `needs-attention` and stops writing.
- It will not invent keys outside `<storeId>/`.
- It will not call anything on a domain you did not type into the settings field.
