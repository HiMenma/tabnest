/**
 * GitHub Gist as a store: one private gist, one file per key.
 *
 * Gist filenames cannot contain "/", so keys are flattened with "__" and mapped
 * back on read. Every write is a PATCH of the whole gist, which keeps listing
 * free and makes the file set cheap to inspect by hand.
 */

import { fromBase64, toBase64 } from "../crypto";
import { BackendError, type BackendOptions, type ObjectStore, type ObjectStoreCaps } from "./types";

const CAPS: ObjectStoreCaps = {
  maxBytes: 700_000,
  supportsList: true,
};

const API = "https://api.github.com/gists";

export function flatten(key: string): string {
  return key.replace(/\//g, "__");
}

export function unflatten(filename: string): string {
  return filename.replace(/__/g, "/");
}

interface GistFile {
  content?: string;
  truncated?: boolean;
  raw_url?: string;
}

interface GistPayload {
  id: string;
  files: Record<string, GistFile>;
}

export function createGistStore(options: BackendOptions): ObjectStore {
  const token = options.token?.trim();
  const gistId = options.gistId?.trim();
  if (!token) throw new BackendError("a GitHub token is required");

  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "content-type": "application/json",
  };

  let cache: GistPayload | null = null;

  const load = async (): Promise<GistPayload> => {
    if (cache) return cache;
    const response = await fetch(`${API}/${gistId}`, {
      headers,
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok)
      throw new BackendError(`gist read failed (${response.status})`, response.status);
    cache = (await response.json()) as GistPayload;
    return cache;
  };

  const patch = async (files: Record<string, { content: string } | null>): Promise<void> => {
    const response = await fetch(`${API}/${gistId}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ files }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok)
      throw new BackendError(`gist write failed (${response.status})`, response.status);
    cache = (await response.json()) as GistPayload;
  };

  const readFile = async (file: GistFile): Promise<Uint8Array | null> => {
    if (typeof file.content === "string" && !file.truncated) return fromBase64(file.content);
    if (file.raw_url) {
      const response = await fetch(file.raw_url, { signal: AbortSignal.timeout(20_000) });
      if (!response.ok) return null;
      return fromBase64(await response.text());
    }
    return null;
  };

  return {
    id: "gist",
    caps: CAPS,

    async get(key) {
      const payload = await load();
      const file = payload.files[flatten(key)];
      if (!file) return null;
      return readFile(file);
    },

    async put(key, bytes) {
      await patch({ [flatten(key)]: { content: toBase64(bytes) } });
    },

    async del(key) {
      try {
        await patch({ [flatten(key)]: null });
      } catch (error) {
        // Deleting a file that is not there is not an error.
        if (error instanceof BackendError && error.status === 404) return;
        throw error;
      }
    },

    async list(prefix) {
      const payload = await load();
      const flat = flatten(prefix);
      return Object.keys(payload.files)
        .filter((name) => name.startsWith(flat))
        .map(unflatten);
    },
  };
}

/** Creates an empty private gist to use as a store. */
export async function createGist(
  token: string,
  description = "TabNest sync store",
): Promise<string> {
  const response = await fetch(API, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      description,
      public: false,
      files: { "tabnest.txt": { content: "Created by TabNest." } },
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok)
    throw new BackendError(`gist create failed (${response.status})`, response.status);
  const payload = (await response.json()) as { id: string };
  return payload.id;
}
