import { describe, expect, it } from "vitest";
import {
  decodeBody,
  encodeBody,
  type SyncOp,
  splitIntoChunks,
} from "../../src/background/sync/codec";
import type { TabItem } from "../../src/data/model";

function tabOp(index: number): SyncOp {
  const node: TabItem = {
    id: `id${index}`,
    kind: "tab",
    url: `https://example.com/article/${index}`,
    title: `Article number ${index} about tabs`,
    host: "example.com",
    parents: ["root"],
    createdAt: 1,
    updatedAt: 1,
  };
  return { op: "upsert", node };
}

describe("encodeBody / decodeBody", () => {
  it("round-trips a payload", async () => {
    const ops: SyncOp[] = [tabOp(1), { op: "delete", id: "gone", at: 5 }];
    const encoded = await encodeBody({ v: 1, ops });
    const decoded = await decodeBody(encoded.bytes, encoded.compression);
    expect(decoded.ops).toEqual(ops);
  });

  it("compresses repetitive payloads", async () => {
    const ops = Array.from({ length: 200 }, (_, index) => tabOp(index));
    const encoded = await encodeBody({ v: 1, ops });
    const plain = new TextEncoder().encode(JSON.stringify({ v: 1, ops })).length;
    expect(encoded.compression).toBe("gzip");
    expect(encoded.bytes.length).toBeLessThan(plain / 2);
  });

  it("rejects an unknown payload version", async () => {
    const bytes = new TextEncoder().encode(JSON.stringify({ v: 9, ops: [] }));
    await expect(decodeBody(bytes, "none")).rejects.toThrow(/unsupported/);
  });
});

describe("splitIntoChunks", () => {
  it("keeps every op, in order, across chunks", async () => {
    const ops = Array.from({ length: 500 }, (_, index) => tabOp(index));
    const chunks = await splitIntoChunks(ops, 2_000);

    const ids = chunks.flatMap((chunk) =>
      chunk.ops.map((op) => (op.op === "upsert" ? op.node.id : "?")),
    );
    expect(ids).toEqual(ops.map((op) => (op.op === "upsert" ? op.node.id : "?")));
  });

  it("respects the encoded size limit", async () => {
    const ops = Array.from({ length: 300 }, (_, index) => tabOp(index));
    const chunks = await splitIntoChunks(ops, 1_200);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) expect(chunk.bytes.length).toBeLessThanOrEqual(1_200);
  });

  it("returns nothing for no ops", async () => {
    expect(await splitIntoChunks([], 1_000)).toEqual([]);
  });

  it("emits an oversized single op rather than dropping it", async () => {
    const huge = tabOp(1);
    if (huge.op === "upsert" && huge.node.kind === "tab") {
      huge.node.url = `https://example.com/${"x".repeat(5_000)}`;
    }
    const chunks = await splitIntoChunks([huge], 300);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.ops).toHaveLength(1);
  });
});
