/**
 * TabNest sync server: the whole contract, in one function.
 *
 * Bind any key/value store with { get, put, delete, list } and an auth token.
 * The reference KV below is provided by the caller (Cloudflare KV in worker.js,
 * a directory in node-server.mjs).
 */

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,PUT,DELETE,HEAD,OPTIONS",
  "access-control-allow-headers": "authorization,content-type,x-tabnest-store",
};

function json(body, init = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { "content-type": "application/json", ...CORS, ...(init.headers ?? {}) },
  });
}

function unauthorized() {
  return new Response("unauthorized", { status: 401, headers: CORS });
}

/** A key is safe when it has no empty, "." or ".." segments. */
function safeKey(pathname) {
  const key = decodeURIComponent(pathname.replace(/^\/+/, ""));
  if (!key) return null;
  const segments = key.split("/");
  for (const segment of segments) {
    if (!segment || segment === "." || segment === "..") return null;
  }
  return key;
}

export async function handle(request, kv, options) {
  const token = options?.token;
  const url = new URL(request.url);

  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

  if (token) {
    const header = request.headers.get("authorization") ?? "";
    const expected = [`Bearer ${token}`, `Basic ${btoa(token)}`];
    if (!expected.includes(header)) return unauthorized();
  }

  // GET /{storeId}/_list?prefix=d/
  const listMatch = /^\/([^/]+)\/_list$/.exec(url.pathname);
  if (listMatch && request.method === "GET") {
    const storeId = decodeURIComponent(listMatch[1]);
    const prefix = `${storeId}/${url.searchParams.get("prefix") ?? ""}`;
    const listed = await kv.list({ prefix });
    return json({ keys: listed.keys.map((entry) => entry.name) });
  }

  // HEAD /{storeId}/ — optional usage reporting
  if (request.method === "HEAD") {
    const prefix = decodeURIComponent(url.pathname.replace(/^\/+/, "")).replace(/\/$/, "");
    if (!prefix) return new Response(null, { status: 404, headers: CORS });
    const listed = await kv.list({ prefix: `${prefix}/` });
    return new Response(null, {
      status: 200,
      headers: {
        ...CORS,
        "x-tabnest-used": String(listed.keys.length * 1024),
      },
    });
  }

  const key = safeKey(url.pathname);
  if (!key) return new Response("bad key", { status: 400, headers: CORS });

  if (request.method === "GET") {
    const value = await kv.get(key, "arrayBuffer");
    if (!value) return new Response("not found", { status: 404, headers: CORS });
    return new Response(value, {
      headers: { "content-type": "application/octet-stream", ...CORS },
    });
  }

  if (request.method === "PUT") {
    await kv.put(key, await request.arrayBuffer());
    return new Response("ok", { headers: CORS });
  }

  if (request.method === "DELETE") {
    await kv.delete(key);
    return new Response("ok", { headers: CORS });
  }

  return new Response("method not allowed", { status: 405, headers: CORS });
}
