/**
 * The one interface every sync backend implements.
 *
 * Keys are flat strings; a store is a namespace of blobs. Nothing here assumes
 * compare-and-swap, listing, or ordering — the engine only ever writes keys under
 * its own device prefix, which is what makes a dumb file store sufficient.
 */
export interface ObjectStoreCaps {
  /** Largest single object the backend accepts, in bytes. */
  maxBytes: number;
  /** Largest whole-store total, in bytes, when the backend has one. */
  maxTotalBytes?: number;
  /** Maximum number of objects, when the backend has a ceiling. */
  maxObjects?: number;
  /** Write rate limit, when the backend counts writes. */
  writesPerMinute?: number;
  /** Whether `list` is real; when false the engine relies on idx.json. */
  supportsList: boolean;
}

export interface Usage {
  used: number;
  quota?: number;
}

export interface ObjectStore {
  readonly id: string;
  readonly caps: ObjectStoreCaps;
  get(key: string): Promise<Uint8Array | null>;
  put(key: string, bytes: Uint8Array): Promise<void>;
  del(key: string): Promise<void>;
  list(prefix: string): Promise<string[]>;
  /** Called when the backend notices a change made elsewhere. */
  watch?(callback: () => void): () => void;
  usage?(): Promise<Usage>;
}

export type BackendFactory = (options: BackendOptions) => Promise<ObjectStore>;

export interface BackendOptions {
  /** Base URL for network backends. */
  baseUrl?: string;
  /** Bearer token or `user:password` for Basic auth. */
  token?: string;
  auth?: "bearer" | "basic";
  /** Gist id for the gist backend. */
  gistId?: string;
}

export interface BackendDescriptor {
  id: string;
  labelKey: string;
  needsConfig: boolean;
  /** Default encryption posture for this backend. */
  encryption: "off" | "passphrase";
  create(options: BackendOptions): Promise<ObjectStore>;
}

export class BackendError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "BackendError";
  }
}
