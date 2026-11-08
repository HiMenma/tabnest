/**
 * Wire format.
 *
 * The body is gzipped JSON. A columnar encoding would shave a few more bytes, but
 * gzip already exploits the repetition in URLs and titles, and a format that can
 * be read with `JSON.parse` is worth more than the last 20%.
 */
import type { Id, Node } from "../../data/model";
import { fromBase64, toBase64 } from "./crypto";

export type SyncOp =
  | { op: "upsert"; node: Node }
  | { op: "delete"; id: Id; at: number }
  | { op: "reorder"; id: Id; children: Id[]; at: number }
  | { op: "settings"; patch: Record<string, unknown>; at: number };

export type Compression = "gzip" | "none";

export interface Payload {
  v: 1;
  ops: SyncOp[];
}

export interface ChunkHead {
  v: 1;
  deviceId: string;
  seq: number;
  kind: "delta" | "snapshot";
  at: number;
  enc: "none" | "aes-gcm";
  kdf?: { alg: "PBKDF2-SHA256"; iter: number; saltB64: string };
  ivB64?: string;
  compression: Compression;
}

export interface StoredChunk extends ChunkHead {
  dataB64: string;
}

export const CHUNK_VERSION = 1;

async function gzip(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function encodeBody(
  payload: Payload,
): Promise<{ bytes: Uint8Array; compression: Compression }> {
  const raw = new TextEncoder().encode(JSON.stringify(payload));
  try {
    const compressed = await gzip(raw);
    if (compressed.length < raw.length) return { bytes: compressed, compression: "gzip" };
  } catch {
    // CompressionStream unavailable or failed; plain JSON is still valid.
  }
  return { bytes: raw, compression: "none" };
}

export async function decodeBody(bytes: Uint8Array, compression: Compression): Promise<Payload> {
  const raw = compression === "gzip" ? await gunzip(bytes) : bytes;
  const parsed = JSON.parse(new TextDecoder().decode(raw)) as Payload;
  if (parsed.v !== 1 || !Array.isArray(parsed.ops)) throw new Error("unsupported chunk payload");
  return parsed;
}

export function packChunk(head: ChunkHead, bytes: Uint8Array): StoredChunk {
  return { ...head, dataB64: toBase64(bytes) };
}

export function unpackChunk(chunk: StoredChunk): { head: ChunkHead; bytes: Uint8Array } {
  const { dataB64, ...head } = chunk;
  return { head, bytes: fromBase64(dataB64) };
}

/**
 * Splits ops into chunks whose encoded form fits `maxEncodedBytes`.
 *
 * Sizing starts from the JSON length (a deliberate overestimate is cheaper than
 * guessing) and re-encodes recursively when the real size is too large.
 */
export async function splitIntoChunks(
  ops: SyncOp[],
  maxEncodedBytes: number,
): Promise<{ ops: SyncOp[]; bytes: Uint8Array; compression: Compression }[]> {
  const out: { ops: SyncOp[]; bytes: Uint8Array; compression: Compression }[] = [];

  const emit = async (slice: SyncOp[]): Promise<void> => {
    if (slice.length === 0) return;
    const encoded = await encodeBody({ v: 1, ops: slice });
    if (encoded.bytes.length <= maxEncodedBytes || slice.length === 1) {
      out.push({ ops: slice, ...encoded });
      return;
    }
    const middle = Math.ceil(slice.length / 2);
    await emit(slice.slice(0, middle));
    await emit(slice.slice(middle));
  };

  // Seed the recursion with JSON-sized groups so the first encode is usually final.
  const groups: SyncOp[][] = [];
  let current: SyncOp[] = [];
  let size = 0;
  const budget = maxEncodedBytes * 2.5;
  for (const op of ops) {
    const length = JSON.stringify(op).length;
    if (current.length > 0 && size + length > budget) {
      groups.push(current);
      current = [];
      size = 0;
    }
    current.push(op);
    size += length;
  }
  if (current.length > 0) groups.push(current);

  for (const slice of groups) await emit(slice);
  return out;
}
