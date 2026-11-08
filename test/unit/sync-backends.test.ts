import { createServer, type Server } from "node:http";
import { IDBFactory } from "fake-indexeddb";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
// The reference server is part of the deliverable, so the client is tested against it.
import { handle } from "../../server/handler.mjs";
import { createGistStore, flatten, unflatten } from "../../src/background/sync/backend/gist";
import { createHttpStore } from "../../src/background/sync/backend/http";
import { createWebdavStore } from "../../src/background/sync/backend/webdav";
import { SyncEngine } from "../../src/background/sync/engine";
import { deleteDb, setIndexedDbFactory } from "../../src/data/idb";
import type { Group, Node } from "../../src/data/model";
import { commitPark, listNodes, prepareTabs } from "../../src/data/repo";

// ---------------------------------------------------------------------------
// a server running the reference handler over an in-memory KV
// ---------------------------------------------------------------------------

const kv = new Map<string, Uint8Array>();

const kvApi = {
  async get(key: string) {
    const value = kv.get(key);
    return value ? value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) : null;
  },
  async put(key: string, value: ArrayBuffer) {
    kv.set(key, new Uint8Array(value));
  },
  async delete(key: string) {
    kv.delete(key);
  },
  async list({ prefix }: { prefix: string }) {
    return {
      keys: [...kv.keys()]
        .filter((key) => key.startsWith(prefix))
        .sort()
        .map((name) => ({ name })),
    };
  },
};

let server: Server;
let baseUrl = "";

async function collect(request: import("node:http").IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

beforeAll(async () => {
  server = createServer(async (request, response) => {
    const body = await collect(request);
    const url = `http://127.0.0.1${request.url ?? "/"}`;
    const webRequest = new Request(url, {
      method: request.method ?? "GET",
      headers: request.headers as Record<string, string>,
      ...(body.length > 0 ? { body: new Uint8Array(body) } : {}),
    });
    const result = await handle(webRequest, kvApi, { token: "secret" });
    response.writeHead(result.status, Object.fromEntries(result.headers));
    response.end(Buffer.from(await result.arrayBuffer()));
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("no port");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(() => {
  server.close();
});

beforeEach(() => {
  kv.clear();
});

// ---------------------------------------------------------------------------
// the custom HTTP backend
// ---------------------------------------------------------------------------

describe("http backend", () => {
  it("puts, gets and deletes a blob", async () => {
    const store = createHttpStore({ baseUrl, token: "secret" });
    const payload = new TextEncoder().encode("hello");
    await store.put("store/d/dev/1.c", payload);
    expect(new TextDecoder().decode((await store.get("store/d/dev/1.c")) ?? new Uint8Array())).toBe(
      "hello",
    );
    await store.del("store/d/dev/1.c");
    expect(await store.get("store/d/dev/1.c")).toBeNull();
  });

  it("lists by prefix", async () => {
    const store = createHttpStore({ baseUrl, token: "secret" });
    await store.put("store/d/dev/1.c", new TextEncoder().encode("a"));
    await store.put("store/d/dev/2.c", new TextEncoder().encode("b"));
    await store.put("other/d/dev/1.c", new TextEncoder().encode("c"));
    expect(await store.list("store/d/")).toEqual(["store/d/dev/1.c", "store/d/dev/2.c"]);
  });

  it("refuses the wrong token", async () => {
    const store = createHttpStore({ baseUrl, token: "wrong" });
    await expect(store.put("store/x", new Uint8Array([1]))).rejects.toThrow(/401/);
  });

  it("rejects path traversal in the reference server", async () => {
    const response = await fetch(`${baseUrl}/store/../../etc/passwd`, {
      headers: { Authorization: "Bearer secret" },
    });
    expect([400, 404]).toContain(response.status);
  });
});

describe("engine over http", () => {
  it("replicates between two devices through the reference server", async () => {
    const factoryA = new IDBFactory();
    setIndexedDbFactory(factoryA);
    await deleteDb();

    const engineA = new SyncEngine(async () => createHttpStore({ baseUrl, token: "secret" }));
    await engineA.init();
    const configured = await engineA.configure({
      backendId: "http",
      options: { baseUrl, token: "secret" },
      passphrase: "hunter2",
    });
    expect(configured.phase).toBe("idle");
    const storeId = configured.storeId;
    if (!storeId) throw new Error("no store id");

    await commitPark(await prepareTabs([{ url: "https://a.example/1", title: "Over HTTP" }]), {
      groupLabel: "Net",
    });
    await engineA.syncNow();

    setIndexedDbFactory(new IDBFactory());
    await deleteDb();
    const engineB = new SyncEngine(async () => createHttpStore({ baseUrl, token: "secret" }));
    await engineB.init();
    await engineB.configure({
      backendId: "http",
      storeId,
      options: { baseUrl, token: "secret" },
      passphrase: "hunter2",
    });
    await engineB.syncNow();

    const nodes = await listNodes();
    const group = nodes.find(
      (node): node is Group => node.kind === "group" && node.label === "Net",
    );
    expect(group).toBeDefined();
    const titles = nodes.filter((node): node is Node => group?.children.includes(node.id) ?? false);
    expect(titles.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// WebDAV
// ---------------------------------------------------------------------------

describe("webdav backend", () => {
  const files = new Map<string, Uint8Array>();
  let davServer: Server;
  let davUrl = "";

  beforeAll(async () => {
    davServer = createServer(async (request, response) => {
      const body = await collect(request);
      const path = decodeURIComponent((request.url ?? "/").split("?")[0] ?? "/");

      if (request.headers.authorization !== `Basic ${btoa("me:secret")}`) {
        response.writeHead(401);
        response.end();
        return;
      }
      if (request.method === "MKCOL") {
        response.writeHead(files.has(`${path}/`) ? 405 : 201);
        response.end();
        return;
      }
      if (request.method === "PROPFIND") {
        const prefix = path.replace(/^\//, "");
        const hrefs = [...files.keys()]
          .filter((key) => key.startsWith(prefix))
          .map((key) => `<D:response><D:href>/${key}</D:href></D:response>`)
          .join("");
        response.writeHead(207, { "content-type": "application/xml" });
        response.end(`<?xml version="1.0"?><D:multistatus>${hrefs}</D:multistatus>`);
        return;
      }
      const key = path.replace(/^\//, "");
      if (request.method === "PUT") {
        files.set(key, body);
        response.writeHead(201);
        response.end();
        return;
      }
      if (request.method === "DELETE") {
        files.delete(key);
        response.writeHead(204);
        response.end();
        return;
      }
      const value = files.get(key);
      if (!value) {
        response.writeHead(404);
        response.end();
        return;
      }
      response.writeHead(200, { "content-type": "application/octet-stream" });
      response.end(Buffer.from(value));
    });
    await new Promise<void>((done) => davServer.listen(0, "127.0.0.1", done));
    const address = davServer.address();
    if (address === null || typeof address === "string") throw new Error("no port");
    davUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(() => {
    davServer.close();
  });

  beforeEach(() => files.clear());

  it("creates directories, writes, reads and lists", async () => {
    const store = createWebdavStore({ baseUrl: davUrl, token: "me:secret", auth: "basic" });
    const payload = new TextEncoder().encode("dav");
    await store.put("s/d/dev/1.c", payload);

    const read = await store.get("s/d/dev/1.c");
    expect(new TextDecoder().decode(read ?? new Uint8Array())).toBe("dav");
    expect(await store.list("s/d/")).toEqual(["s/d/dev/1.c"]);

    await store.del("s/d/dev/1.c");
    expect(await store.get("s/d/dev/1.c")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Gist
// ---------------------------------------------------------------------------

describe("gist backend", () => {
  const gistFiles = new Map<string, string>();

  beforeEach(() => {
    gistFiles.clear();
    gistFiles.set("tabnest.txt", "Created by TabNest.");

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (!url.startsWith("https://api.github.com/gists"))
          return new Response("nope", { status: 404 });

        if (!init || init.method === undefined || init.method === "GET") {
          const files: Record<string, { content: string }> = {};
          for (const [name, content] of gistFiles) files[name] = { content };
          return Response.json({ id: "g1", files });
        }

        if (init.method === "PATCH") {
          const body = JSON.parse(String(init.body)) as {
            files: Record<string, { content: string } | null>;
          };
          for (const [name, file] of Object.entries(body.files)) {
            if (file === null) gistFiles.delete(name);
            else gistFiles.set(name, file.content);
          }
          const files: Record<string, { content: string }> = {};
          for (const [name, content] of gistFiles) files[name] = { content };
          return Response.json({ id: "g1", files });
        }

        return new Response("unsupported", { status: 405 });
      }),
    );
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it("maps keys to flat file names", () => {
    expect(flatten("store/d/dev/1.c")).toBe("store__d__dev__1.c");
    expect(unflatten(flatten("store/d/dev/1.c"))).toBe("store/d/dev/1.c");
  });

  it("puts, gets, lists and deletes through the gist API", async () => {
    const store = createGistStore({ token: "pat", gistId: "g1" });
    await store.put("s/d/dev/1.c", new TextEncoder().encode("gist"));

    const read = await store.get("s/d/dev/1.c");
    expect(new TextDecoder().decode(read ?? new Uint8Array())).toBe("gist");
    expect(await store.list("s/d/")).toEqual(["s/d/dev/1.c"]);

    await store.del("s/d/dev/1.c");
    expect(await store.get("s/d/dev/1.c")).toBeNull();
  });
});
