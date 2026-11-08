/**
 * Self-hosted server for the custom HTTP backend.
 *
 *   TN_TOKEN=secret TN_DIR=./data node server/node-server.mjs --port 8787
 *
 * Then point TabNest at http://127.0.0.1:8787/ with that token. The storage is a
 * directory of files named after the keys, so a store can be inspected, backed
 * up, or rsync'd with ordinary tools.
 */

import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, join, relative, resolve, sep } from "node:path";
import { handle } from "./handler.mjs";

const root = resolve(process.env.TN_DIR ?? "./data");
const token = process.env.TN_TOKEN;

function pathFor(key) {
  const target = resolve(join(root, key));
  if (!target.startsWith(root + sep)) throw new Error("key escapes the store");
  return target;
}

const kv = {
  async get(key) {
    try {
      const bytes = await readFile(pathFor(key));
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    } catch {
      return null;
    }
  },
  async put(key, value) {
    const target = pathFor(key);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, Buffer.from(value));
  },
  async delete(key) {
    await rm(pathFor(key), { force: true });
  },
  async list({ prefix }) {
    const base = resolve(join(root, prefix));
    const keys = [];
    const walk = async (directory) => {
      let entries;
      try {
        entries = await readdir(directory, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const full = join(directory, entry.name);
        if (entry.isDirectory()) {
          await walk(full);
        } else {
          keys.push({ name: relative(root, full).split(sep).join("/") });
        }
      }
    };
    const info = await stat(base).catch(() => null);
    if (info?.isDirectory()) await walk(base);
    else if (info?.isFile()) keys.push({ name: relative(root, base).split(sep).join("/") });
    return { keys: keys.sort() };
  },
};

const port = Number(
  process.argv.includes("--port")
    ? process.argv[process.argv.indexOf("--port") + 1]
    : (process.env.PORT ?? 8787),
);

const server = createServer(async (request, response) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const body = Buffer.concat(chunks);

  const url = `http://${request.headers.host ?? "localhost"}${request.url}`;
  const webRequest = new Request(url, {
    method: request.method,
    headers: request.headers,
    ...(["GET", "HEAD"].includes(request.method ?? "GET") ? {} : { body }),
  });

  try {
    const webResponse = await handle(webRequest, kv, { token });
    response.writeHead(webResponse.status, Object.fromEntries(webResponse.headers));
    const buffer = Buffer.from(await webResponse.arrayBuffer());
    response.end(buffer);
  } catch (error) {
    console.error("request failed", error);
    response.writeHead(500);
    response.end("internal error");
  }
});

await mkdir(root, { recursive: true });
server.listen(port, "127.0.0.1", () => {
  console.log(`tabnest sync server on http://127.0.0.1:${port}/ (store: ${root})`);
  console.log(token ? "auth: bearer token required" : "auth: open (set TN_TOKEN to require one)");
});
