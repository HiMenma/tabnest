/**
 * A user-supplied HTTP endpoint implementing the contract in docs/backends.md.
 *
 * Seven routes, no coordination, no server-side smarts: whatever can PUT and GET
 * a named blob works.
 */
import {
  BackendError,
  type BackendOptions,
  type ObjectStore,
  type ObjectStoreCaps,
  type Usage,
} from "./types";

export const HTTP_CAPS: ObjectStoreCaps = {
  maxBytes: 1_048_576,
  supportsList: true,
};

function baseUrl(options: BackendOptions): string {
  const url = options.baseUrl?.trim();
  if (!url) throw new BackendError("a base URL is required");
  return url.replace(/\/+$/, "");
}

export function authHeaders(options: BackendOptions): Record<string, string> {
  if (!options.token) return {};
  if (options.auth === "basic") return { Authorization: `Basic ${btoa(options.token)}` };
  return { Authorization: `Bearer ${options.token}` };
}

function encodePath(key: string): string {
  return key
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

async function request(
  url: string,
  options: BackendOptions,
  init: RequestInit = {},
): Promise<Response> {
  const response = await fetch(url, {
    ...init,
    headers: { ...authHeaders(options), ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(30_000),
  });
  return response;
}

export function createHttpStore(options: BackendOptions): ObjectStore {
  const root = baseUrl(options);
  const caps: ObjectStoreCaps = {
    ...HTTP_CAPS,
    ...(typeof options.maxBytes === "number" ? { maxBytes: options.maxBytes } : {}),
  };

  return {
    id: "http",
    caps,

    async get(key) {
      const response = await request(`${root}/${encodePath(key)}`, options);
      if (response.status === 404) return null;
      if (!response.ok) throw new BackendError(`GET ${key} failed`, response.status);
      return new Uint8Array(await response.arrayBuffer());
    },

    async put(key, bytes) {
      const response = await request(`${root}/${encodePath(key)}`, options, {
        method: "PUT",
        body: bytes as BodyInit,
        headers: { "content-type": "application/octet-stream" },
      });
      if (!response.ok)
        throw new BackendError(`PUT ${key} failed (${response.status})`, response.status);
    },

    async del(key) {
      const response = await request(`${root}/${encodePath(key)}`, options, { method: "DELETE" });
      if (!response.ok && response.status !== 404) {
        throw new BackendError(`DELETE ${key} failed (${response.status})`, response.status);
      }
    },

    async list(prefix) {
      const storeId = prefix.split("/")[0] ?? "";
      const relative = prefix.slice(storeId.length + 1);
      const url = `${root}/${encodeURIComponent(storeId)}/_list?prefix=${encodeURIComponent(relative)}`;
      const response = await request(url, options);
      if (response.status === 404) throw new BackendError("this endpoint cannot list", 404);
      if (!response.ok) throw new BackendError(`LIST failed (${response.status})`, response.status);
      const body = (await response.json()) as { keys?: unknown };
      if (!Array.isArray(body.keys)) throw new BackendError("LIST returned an unexpected body");
      return body.keys.filter((key): key is string => typeof key === "string");
    },

    async usage(): Promise<Usage> {
      // The contract has no usage route; a HEAD on the store root is optional.
      try {
        const response = await request(`${root}/`, options, { method: "HEAD" });
        const used = Number(response.headers.get("x-tabnest-used"));
        if (Number.isFinite(used) && used >= 0) {
          const quota = Number(response.headers.get("x-tabnest-quota"));
          return Number.isFinite(quota) && quota > 0 ? { used, quota } : { used };
        }
      } catch {
        // fall through
      }
      return { used: 0 };
    },
  };
}
