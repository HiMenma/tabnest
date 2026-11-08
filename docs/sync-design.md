# Sync design

Status: designed (M4/M5 implement it). This document is the contract; code follows it.

## Shape of the problem

- Several devices, each with a full copy of the library.
- No first-party server, so no place to run conflict logic.
- The default backend is `chrome.storage.sync`: 100 KB total, 8 KB per entry,
  512 entries, and **no compare-and-swap**.
- The other backends are dumb file stores (WebDAV folder, Gist files, a handful
  of HTTP routes).

That rules out anything requiring a coordinator. The design is therefore an
**append-only log per device**, replicated through a key-value namespace, with
deterministic merge on read.

## Layering

```
repo mutation ──same IndexedDB transaction──> change journal
                                                    │
                                          engine.flush: take a batch
                                                    │
                              codec.encode → gzip → crypto.encrypt
                                                    │
                              ObjectStore.put("d/<deviceId>/<seq>.c")
                                                    ▲
         engine.pull: list() → get() → decrypt → decode
                                                    │
                              apply: last-write-wins per record
                                                    │
                              broadcast {type:"data-changed"}
```

The journal is written inside the same transaction as the mutation it describes,
so a crash cannot lose a change or record one twice. The only repair path is
`reconcile()`, a snapshot diff used after imports and as a self-heal.

## ObjectStore

Every backend implements exactly this:

```ts
interface ObjectStore {
  readonly id: string;
  readonly caps: {
    maxBytes: number; // single object ceiling
    maxTotalBytes?: number; // whole-store ceiling
    maxObjects?: number;
    writesPerMinute?: number;
    supportsList: boolean;
  };
  get(key: string): Promise<Uint8Array | null>;
  put(key: string, bytes: Uint8Array): Promise<void>;
  del(key: string): Promise<void>;
  list(prefix: string): Promise<string[]>;
  watch?(cb: () => void): () => void; // chrome.storage.sync uses onChanged
  usage?(): Promise<{ used: number; quota: number }>;
}
```

`list` matters: it is what makes the index optional (see below).

## Key layout

```
<storeId>/meta.json                 KDF parameters, storeId, created-at
<storeId>/idx.json                  per-device latest seq — a cache, never authoritative
<storeId>/d/<deviceId>/<seq>.c      change chunks; only that device writes this prefix
```

**Each device writes only its own prefix.** Concurrent writers therefore never
touch the same key, which is what removes the need for locking, CAS, or an
atomic rename. `idx.json` is an optimisation for backends where `list` is
expensive; it is never trusted for correctness. Losing it costs one extra `list`.

`storeId` is a random UUID generated when sync is first configured and shown in
the UI, so two unrelated libraries can share one backend root.

## Chunk format

```ts
type Chunk = {
  v: 1;
  deviceId: string;
  seq: number; // per-device, monotonic, gaps allowed
  kind: "delta" | "snapshot";
  at: number;
  enc: "none" | "aes-gcm";
  kdf?: { alg: "PBKDF2-SHA256"; iter: number; saltB64: string };
  ivB64?: string;
  dataB64: string; // gzip(payload), or ciphertext of that
};

type Payload = {
  ops: Array<
    | { op: "upsert"; node: Node }
    | { op: "delete"; id: Id; at: number }
    | { op: "reorder"; id: Id; children: Id[]; at: number }
    | { op: "settings"; patch: Partial<Settings>; at: number }
  >;
};
```

Three encoding tricks keep a chunk small:

1. **Columnar bodies.** Nodes are spread into parallel arrays instead of an array
   of objects; keys are implicit by position.
2. **Block-local dictionaries** for hosts and parent ids, referenced by index.
3. **gzip** via `CompressionStream`, skipped when it does not help.

Measured target: 35–60 bytes per tab in a 200-tab chunk.

## Applying remote work

For each `op`, in `seq` order per device:

| Situation                        | Resolution                                                                                  |
| -------------------------------- | ------------------------------------------------------------------------------------------- |
| both sides changed a node        | higher `updatedAt` wins; ties broken by `deviceId` compare                                  |
| delete vs update                 | delete wins when `tombstone.at >= node.updatedAt`, otherwise the update resurrects the node |
| both added children to one group | union; unrecognised children appended by `(updatedAt, id)`                                  |
| child order                      | `reorder` wins only when the group's `updatedAt` is not newer locally                       |
| settings                         | per-key last-write-wins using `at`                                                          |
| unknown `op` or `v`              | ignored, counted in diagnostics; never fatal                                                |

Tombstones are kept 90 days so a long-offline device cannot resurrect a
deliberate deletion, then garbage-collected.

Every apply is idempotent: replaying a chunk produces no change, which is why a
crash mid-apply is safe.

## Compaction

When a device's chunk count for its own prefix exceeds 32, it writes a
`kind: "snapshot"` chunk containing the full library and deletes its older
chunks in the same flush. Other devices prune their cursors when they read a
snapshot. Snapshots are also what makes a new device's first pull cheap.

## Quota guard (chrome.storage.sync)

Hard limits: 102 400 bytes total, 8 192 per entry, 512 entries, 120 writes per
minute.

- Chunk target: **5.5 KB raw**, which becomes ≈7.3 KB after base64 — under the
  8 KB per-entry ceiling.
- Practical capacity: roughly **1500–2500 tabs** depending on title lengths.
- On overflow the engine degrades in this order, and **never truncates silently**:
  1. push deltas only, skip the snapshot;
  2. enter `paused:too-large`, showing current usage, the overflow, and three
     actions: switch backend / empty trash / enable structure-only mode;
  3. structure-only mode syncs folder and group skeletons, not tab records.

Writes are batched: at most 8 keys per flush, with a 60 s backoff if the write
rate limit is hit.

## Encryption

| Backend                          | Default                 | Note                                                                         |
| -------------------------------- | ----------------------- | ---------------------------------------------------------------------------- |
| `chrome-sync`                    | off                     | the data is already inside the user's Google account; the UI says so plainly |
| `webdav`, `http`, `gist`, `file` | on, passphrase required | real end-to-end                                                              |

- `PBKDF2-SHA256`, 600 000 iterations, 32-byte key, random salt stored in `meta.json`.
- `AES-GCM`, 12-byte random IV per chunk.
- AAD binds the chunk to its position: `` `${storeId}|${deviceId}|${seq}` ``, so a
  chunk cannot be moved, duplicated, or reordered without failing to decrypt.
- The derived key lives in service-worker memory only, never in storage.
- A **recovery code** (base32 of the raw key, in groups of four) can be exported
  once for disaster recovery. The UI states the consequence: lose both the
  passphrase and the code, and the remote data is unrecoverable by design.

## Scheduling (MV3 realities)

| Trigger                                           | Why                                     |
| ------------------------------------------------- | --------------------------------------- |
| debounce 3 s after a local mutation               | keeps the common case near-instant      |
| `chrome.alarms` every minute                      | survives worker termination             |
| `chrome.storage.onChanged` (chrome-sync only)     | other devices' writes arrive in seconds |
| `poke` every 15 s while a TabNest page is visible | low latency during active use           |
| `onStartup` / `onInstalled`                       | catch up after the browser was closed   |
| manual "sync now"                                 | when the user wants certainty           |

A single writer lock (`navigator.locks`, with a `meta.syncLock` fallback) ensures
two flushes never interleave.

## State machine

```
disabled → unconfigured → idle ⇄ syncing
                              ↓ error
                    paused:{auth | too-large | rate-limited | offline | quota | clock-skew}
                              ↓
                    needs-attention (missing passphrase, backend 404)
```

The state is broadcast to every surface; the sync page and the extension badge
render from the same value.

## Diagnostics

Each flush records `{ at, pushed, pulled, bytes, duration, error? }` in a capped
ring buffer in `meta`. The sync page can export it, which is the difference
between "sync is broken" and a bug report someone can act on.
