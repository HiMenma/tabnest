/**
 * The sync engine.
 *
 * One writer per device, appending chunks under its own key prefix. Readers merge
 * whatever they find with last-write-wins per record. That is the whole protocol:
 * no coordinator, no compare-and-swap, no clock beyond `updatedAt`.
 */
import type { Id, Node } from "../../data/model";
import {
  allNodes,
  applyRemoteOps,
  countQueuedChanges,
  deleteChanges,
  getMeta,
  listQueuedChanges,
  repair,
  setJournalEnabled,
  setMeta,
} from "../../data/repo";
import { createStore } from "./backend";
import type { BackendOptions, ObjectStore } from "./backend/types";
import {
  decodeBody,
  packChunk,
  type StoredChunk,
  type SyncOp,
  splitIntoChunks,
  unpackChunk,
} from "./codec";
import { chunkAad, deriveKey, fromBase64, KDF_ITERATIONS, open, seal, toBase64 } from "./crypto";

export type SyncPhase =
  | "disabled"
  | "unconfigured"
  | "idle"
  | "syncing"
  | "paused"
  | "needs-attention";

export interface SyncStatus {
  phase: SyncPhase;
  reason?: string;
  backendId?: string;
  storeId?: string;
  queued: number;
  chunks?: number;
  lastSyncAt?: number;
  message?: string;
  encryption: "off" | "passphrase";
  usage?: { used: number; quota?: number };
}

export interface SyncConfig {
  backendId: string;
  storeId: string;
  options: BackendOptions;
  encryption: "off" | "passphrase";
  /** Raw AES key, kept locally so a worker restart does not need the passphrase. */
  dataKeyB64?: string;
  saltB64?: string;
}

interface SyncState {
  ownSeq: number;
  cursors: Record<string, number>;
  lastSyncAt?: number;
}

interface RemoteMeta {
  v: 1;
  storeId: string;
  createdAt: number;
  encrypted: boolean;
  kdf?: { alg: "PBKDF2-SHA256"; iter: number; saltB64: string };
  keyFingerprint?: string;
}

const CONFIG_KEY = "syncConfig";
const STATE_KEY = "syncState";
const MAX_OWN_CHUNKS = 32;

export class SyncConflictFreeError extends Error {}

function emptyState(): SyncState {
  return { ownSeq: 0, cursors: {} };
}

export class SyncEngine {
  private config: SyncConfig | null = null;
  private state: SyncState = emptyState();
  private store: ObjectStore | null = null;
  private key: CryptoKey | null = null;
  private deviceId = "";
  private phase: SyncPhase = "unconfigured";
  private message: string | undefined;
  private inflight: Promise<void> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private unwatch: (() => void) | null = null;
  private listeners = new Set<(status: SyncStatus) => void>();

  constructor(private readonly storeFactory = createStore) {}

  // -- lifecycle -----------------------------------------------------------

  async init(): Promise<void> {
    this.deviceId = (await getMeta<string>("installId")) ?? "unknown-device";
    const config = await getMeta<SyncConfig>(CONFIG_KEY);
    const state = await getMeta<SyncState>(STATE_KEY);
    if (state) this.state = { ...emptyState(), ...state };

    if (!config) {
      this.phase = "unconfigured";
      setJournalEnabled(false);
      return;
    }

    try {
      await this.attach(config);
      this.phase = "idle";
      this.schedule(1500);
    } catch (error) {
      this.phase = "needs-attention";
      this.message = error instanceof Error ? error.message : String(error);
    }
  }

  private async attach(config: SyncConfig): Promise<void> {
    this.config = config;
    this.store = await this.storeFactory(config.backendId, config.options);
    this.key = config.dataKeyB64 ? await this.importKey(config.dataKeyB64) : null;
    setJournalEnabled(true);

    this.unwatch?.();
    this.unwatch = this.store.watch?.(() => this.schedule(400)) ?? null;
  }

  private async importKey(rawB64: string): Promise<CryptoKey> {
    return crypto.subtle.importKey("raw", fromBase64(rawB64) as BufferSource, "AES-GCM", false, [
      "encrypt",
      "decrypt",
    ]);
  }

  onStatus(listener: (status: SyncStatus) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private async emit(): Promise<void> {
    const status = await this.status();
    for (const listener of this.listeners) listener(status);
  }

  // -- configuration -------------------------------------------------------

  async status(): Promise<SyncStatus> {
    const queued = await countQueuedChanges();
    const base: SyncStatus = {
      phase: this.phase,
      queued,
      encryption: this.config?.encryption ?? "off",
      ...(this.config ? { backendId: this.config.backendId, storeId: this.config.storeId } : {}),
      ...(this.message === undefined ? {} : { message: this.message }),
      ...(this.state.lastSyncAt === undefined ? {} : { lastSyncAt: this.state.lastSyncAt }),
    };

    if (this.store?.usage) {
      try {
        base.usage = await this.store.usage();
      } catch {
        // usage is advisory
      }
    }
    return base;
  }

  async configure(input: {
    backendId: string;
    storeId?: string;
    options?: BackendOptions;
    passphrase?: string;
  }): Promise<SyncStatus> {
    const storeId = input.storeId?.trim() || crypto.randomUUID();
    const options = input.options ?? {};
    const descriptor = (await import("./backend/index")).findBackend(input.backendId);
    if (!descriptor) throw new Error(`unknown backend ${input.backendId}`);

    const store = await this.storeFactory(input.backendId, options);

    let dataKeyB64: string | undefined;
    let saltB64: string | undefined;
    let fingerprint: string | undefined;
    let encryption: "off" | "passphrase" = "off";

    if (descriptor.encryption === "passphrase") {
      if (!input.passphrase) throw new Error("this backend needs a passphrase");
      encryption = "passphrase";
      const existing = await this.readRemoteMeta(store, storeId);
      saltB64 = existing?.kdf?.saltB64 ?? toBase64(crypto.getRandomValues(new Uint8Array(16)));
      const key = await deriveKey(input.passphrase, fromBase64(saltB64));
      dataKeyB64 = toBase64(new Uint8Array(await crypto.subtle.exportKey("raw", key)));
      fingerprint = await fingerprintOf(dataKeyB64);
    }

    const remote = await this.readRemoteMeta(store, storeId);
    if (!remote) {
      const meta: RemoteMeta = {
        v: 1,
        storeId,
        createdAt: Date.now(),
        encrypted: encryption === "passphrase",
        ...(saltB64
          ? { kdf: { alg: "PBKDF2-SHA256" as const, iter: KDF_ITERATIONS, saltB64 } }
          : {}),
        ...(fingerprint ? { keyFingerprint: fingerprint } : {}),
      };
      await store.put(`${storeId}/meta.json`, new TextEncoder().encode(JSON.stringify(meta)));
    } else if (fingerprint && remote.keyFingerprint && remote.keyFingerprint !== fingerprint) {
      throw new Error("that passphrase does not match this sync store");
    }

    const config: SyncConfig = {
      backendId: input.backendId,
      storeId,
      options,
      encryption,
      ...(dataKeyB64 ? { dataKeyB64 } : {}),
      ...(saltB64 ? { saltB64 } : {}),
    };

    await setMeta(CONFIG_KEY, config);
    this.config = config;
    this.state = emptyState();
    await setMeta(STATE_KEY, this.state);
    await this.attach(config);

    this.phase = "idle";
    this.message = undefined;

    // Turning sync on does three things in order, so the caller learns
    // immediately whether it works: catch up on what is already in the store,
    // publish this device's library, then drain anything still queued.
    await this.syncNow();
    try {
      await this.writeSnapshot();
    } catch (error) {
      // A store too small for the library is a state, not an exception: keep the
      // configuration and report why the first upload failed.
      this.phase = "paused";
      this.message = error instanceof Error ? error.message : String(error);
      void this.emit();
      return this.status();
    }
    return this.syncNow();
  }

  async disable(): Promise<SyncStatus> {
    this.config = null;
    this.store = null;
    this.key = null;
    this.phase = "disabled";
    this.message = undefined;
    this.unwatch?.();
    this.unwatch = null;
    setJournalEnabled(false);
    await setMeta(CONFIG_KEY, null);
    return this.status();
  }

  private async readRemoteMeta(store: ObjectStore, storeId: string): Promise<RemoteMeta | null> {
    const bytes = await store.get(`${storeId}/meta.json`);
    if (!bytes) return null;
    try {
      return JSON.parse(new TextDecoder().decode(bytes)) as RemoteMeta;
    } catch {
      return null;
    }
  }

  // -- scheduling ----------------------------------------------------------

  schedule(delayMs = 3000): void {
    if (!this.config) return;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.syncNow();
    }, delayMs);
  }

  async syncNow(): Promise<SyncStatus> {
    if (!this.config || !this.store) return this.status();

    // Serialise: a click on "sync now" while an alarm-driven pass is running
    // waits for it instead of returning a stale phase.
    const running = this.inflight;
    if (running) await running.catch(() => undefined);

    this.inflight = this.flush();
    try {
      await this.inflight;
    } finally {
      this.inflight = null;
    }
    return this.status();
  }

  // -- the round trip ------------------------------------------------------

  private chunkKey(deviceId: string, seq: number): string {
    return `${this.config?.storeId}/d/${deviceId}/${seq}.c`;
  }

  private rawBudget(): number {
    const caps = this.store?.caps;
    return Math.max(512, Math.floor((caps?.maxBytes ?? 5_600) * 0.7));
  }

  private async flush(): Promise<void> {
    if (!this.config || !this.store) return;
    this.phase = "syncing";
    this.message = undefined;
    void this.emit();

    try {
      await this.push();
      await this.pull();
      this.state.lastSyncAt = Date.now();
      await setMeta(STATE_KEY, this.state);
      this.phase = "idle";
    } catch (error) {
      this.phase = "paused";
      this.message = error instanceof Error ? error.message : String(error);
    } finally {
      void this.emit();
    }
  }

  private async push(): Promise<void> {
    const store = this.store;
    const config = this.config;
    if (!store || !config) return;

    const pending = await listQueuedChanges(1_000);
    if (pending.length === 0) return;

    await this.assertBudget(0);
    const chunks = await splitIntoChunks(
      pending.map((row) => row.op),
      this.rawBudget(),
    );

    for (const chunk of chunks) {
      const seq = this.state.ownSeq + 1;
      const stored = await this.sealChunk(chunk, seq, "delta");
      const encoded = new TextEncoder().encode(JSON.stringify(stored));
      if (encoded.length > store.caps.maxBytes) {
        throw new Error(`chunk did not fit: ${encoded.length} > ${store.caps.maxBytes}`);
      }
      await this.assertBudget(encoded.length);
      await store.put(this.chunkKey(this.deviceId, seq), encoded);
      this.state.ownSeq = seq;
    }

    await deleteChanges(pending.map((row) => row.seq));
    await this.maybeCompact();
  }

  private async sealChunk(
    chunk: { bytes: Uint8Array; compression: "gzip" | "none" },
    seq: number,
    kind: "delta" | "snapshot",
  ): Promise<StoredChunk> {
    let payload = chunk.bytes;
    let enc: "none" | "aes-gcm" = "none";
    let ivB64: string | undefined;

    if (this.key && this.config) {
      const sealed = await seal(
        this.key,
        payload,
        chunkAad(this.config.storeId, this.deviceId, seq),
      );
      payload = sealed.ciphertext;
      ivB64 = sealed.ivB64;
      enc = "aes-gcm";
    }

    return packChunk(
      {
        v: 1,
        deviceId: this.deviceId,
        seq,
        kind,
        at: Date.now(),
        enc,
        compression: chunk.compression,
        ...(this.config?.encryption === "passphrase" && this.config.saltB64
          ? {
              kdf: {
                alg: "PBKDF2-SHA256" as const,
                iter: KDF_ITERATIONS,
                saltB64: this.config.saltB64,
              },
            }
          : {}),
        ...(ivB64 ? { ivB64 } : {}),
      },
      payload,
    );
  }

  private async assertBudget(incoming: number): Promise<void> {
    const store = this.store;
    if (!store?.usage) return;
    const usage = await store.usage();
    const quota = usage.quota ?? store.caps.maxTotalBytes;
    if (quota === undefined) return;
    if (usage.used + incoming > quota * 0.95) {
      throw new Error(
        `this backend is nearly full (${Math.round(usage.used / 1024)} KiB of ${Math.round(
          quota / 1024,
        )} KiB); compact or switch backends`,
      );
    }
  }

  private async pull(): Promise<void> {
    const store = this.store;
    const config = this.config;
    if (!store || !config) return;

    const keys = await store.list(`${config.storeId}/d/`);
    const byDevice = new Map<string, number[]>();

    for (const key of keys) {
      const rest = key.slice(`${config.storeId}/d/`.length);
      const [deviceId, file] = rest.split("/");
      if (!deviceId || !file) continue;
      const seq = Number.parseInt(file.replace(/\.c$/, ""), 10);
      if (!Number.isFinite(seq)) continue;
      if (deviceId === this.deviceId) continue;
      const list = byDevice.get(deviceId);
      if (list) list.push(seq);
      else byDevice.set(deviceId, [seq]);
    }

    for (const [deviceId, seqs] of byDevice) {
      const cursor = this.state.cursors[deviceId] ?? 0;
      for (const seq of seqs.sort((a, b) => a - b)) {
        if (seq <= cursor) continue;
        const bytes = await store.get(this.chunkKey(deviceId, seq));
        if (!bytes) continue;
        await this.applyChunk(bytes, deviceId, seq);
        this.state.cursors[deviceId] = seq;
      }
    }
  }

  private async applyChunk(bytes: Uint8Array, deviceId: string, seq: number): Promise<void> {
    const stored = JSON.parse(new TextDecoder().decode(bytes)) as StoredChunk;
    if (stored.v !== 1) return;

    let payload = unpackChunk(stored).bytes;
    if (stored.enc === "aes-gcm") {
      if (!this.key || !this.config) throw new Error("this store is encrypted");
      payload = await open(
        this.key,
        stored.ivB64 ?? "",
        payload,
        chunkAad(this.config.storeId, deviceId, seq),
      );
    }

    const decoded = await decodeBody(payload, stored.compression);
    await applyRemoteOps(decoded.ops);
    await repair();
  }

  private async maybeCompact(): Promise<void> {
    const store = this.store;
    const config = this.config;
    if (!store || !config) return;

    const keys = await store.list(`${config.storeId}/d/${this.deviceId}/`);
    if (keys.length <= MAX_OWN_CHUNKS) return;
    await this.writeSnapshot();
  }

  /**
   * Publishes the whole library as one or more snapshot chunks and drops the
   * history they supersede. Used for the first upload, on join, and on compaction.
   */
  private async writeSnapshot(): Promise<void> {
    const store = this.store;
    const config = this.config;
    if (!store || !config) return;

    const keys = (await store.list(`${config.storeId}/d/${this.deviceId}/`)).sort();
    const nodes = await allNodes();
    const ops: SyncOp[] = nodes.map((node: Node) => ({ op: "upsert" as const, node }));
    const chunks = await splitIntoChunks(ops, this.rawBudget());

    // Write the snapshot first, then drop the history it supersedes.
    let seq = this.state.ownSeq;
    const written: string[] = [];
    for (const chunk of chunks) {
      seq += 1;
      const stored = await this.sealChunk(chunk, seq, "snapshot");
      const encoded = new TextEncoder().encode(JSON.stringify(stored));
      if (encoded.length > store.caps.maxBytes) {
        throw new Error(`snapshot chunk did not fit: ${encoded.length}`);
      }
      const key = this.chunkKey(this.deviceId, seq);
      await store.put(key, encoded);
      written.push(key);
    }

    for (const key of keys) await store.del(key);
    this.state.ownSeq = seq;
    await setMeta(STATE_KEY, this.state);
  }
}

async function fingerprintOf(dataKeyB64: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", fromBase64(dataKeyB64) as BufferSource);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 32);
}

export const syncEngine = new SyncEngine();

export type { Id };
