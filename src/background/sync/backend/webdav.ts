/**
 * WebDAV: Nextcloud, ownCloud, Synology, 坚果云, or a plain nginx with dav.
 *
 * Directories are created on demand (PUT does not create parents), and listing
 * uses PROPFIND with Depth: 1. Extension host permissions mean CORS does not
 * apply, which is why this works against servers that never set CORS headers.
 */

import { authHeaders } from "./http";
import { BackendError, type BackendOptions, type ObjectStore, type ObjectStoreCaps } from "./types";

const CAPS: ObjectStoreCaps = {
  maxBytes: 4 * 1024 * 1024,
  supportsList: true,
};

function baseUrl(options: BackendOptions): string {
  const url = options.baseUrl?.trim();
  if (!url) throw new BackendError("a WebDAV URL is required");
  return url.replace(/\/+$/, "");
}

function encodePath(key: string): string {
  return key
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

export function createWebdavStore(options: BackendOptions): ObjectStore {
  const root = baseUrl(options);
  const created = new Set<string>();
  const headers = authHeaders(options);

  const call = async (url: string, init: RequestInit = {}): Promise<Response> =>
    fetch(url, {
      ...init,
      headers: { ...headers, ...(init.headers ?? {}) },
      signal: AbortSignal.timeout(30_000),
    });

  const ensureDir = async (path: string): Promise<void> => {
    if (path === "" || created.has(path)) return;
    const response = await call(`${root}/${encodePath(path)}`, { method: "MKCOL" });
    // 405 = already there; both outcomes are fine.
    if (!response.ok && response.status !== 405 && response.status !== 301) {
      throw new BackendError(`MKCOL ${path} failed (${response.status})`, response.status);
    }
    created.add(path);
  };

  const ensureParents = async (key: string): Promise<void> => {
    const parts = key.split("/");
    parts.pop();
    let current = "";
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      await ensureDir(current);
    }
  };

  return {
    id: "webdav",
    caps: CAPS,

    async get(key) {
      const response = await call(`${root}/${encodePath(key)}`);
      if (response.status === 404) return null;
      if (!response.ok)
        throw new BackendError(`GET ${key} failed (${response.status})`, response.status);
      return new Uint8Array(await response.arrayBuffer());
    },

    async put(key, bytes) {
      await ensureParents(key);
      const response = await call(`${root}/${encodePath(key)}`, {
        method: "PUT",
        body: bytes as BodyInit,
        headers: { "content-type": "application/octet-stream" },
      });
      if (!response.ok)
        throw new BackendError(`PUT ${key} failed (${response.status})`, response.status);
    },

    async del(key) {
      const response = await call(`${root}/${encodePath(key)}`, { method: "DELETE" });
      if (!response.ok && response.status !== 404) {
        throw new BackendError(`DELETE ${key} failed (${response.status})`, response.status);
      }
    },

    async list(prefix) {
      const directory = prefix.endsWith("/") ? prefix.slice(0, -1) : prefix;
      const response = await call(`${root}/${encodePath(directory)}/`, {
        method: "PROPFIND",
        headers: { Depth: "1", "content-type": "application/xml" },
      });
      if (response.status === 404) return [];
      if (!response.ok)
        throw new BackendError(`PROPFIND failed (${response.status})`, response.status);

      const xml = await response.text();
      const hrefs = [...xml.matchAll(/<[^>]*href>([^<]+)<\/[^>]*href>/gi)].map((match) =>
        decodeURIComponent(match[1] ?? ""),
      );
      const prefixPath = `/${directory}/`;
      const keys: string[] = [];
      for (const href of hrefs) {
        const index = href.indexOf(prefixPath);
        if (index === -1) continue;
        const name = href.slice(index + prefixPath.length).replace(/\/$/, "");
        if (!name) continue;
        keys.push(`${directory}/${name}`);
      }
      return keys;
    },
  };
}
