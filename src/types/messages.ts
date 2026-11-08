/**
 * The message bus between extension pages and the service worker.
 *
 * Kept as one discriminated union so both sides fail to compile when a message
 * shape drifts. Sync messages are added in M4.
 */

export interface PingRequest {
  type: "ping";
}

export interface PingResponse {
  ok: true;
  version: string;
  at: number;
}

/** Everything a page may send. */
export type RequestMessage = PingRequest;

/** Everything the worker may reply with, keyed by request type. */
export interface ResponseByRequest {
  ping: PingResponse;
}

export type ResponseFor<T extends RequestMessage> = ResponseByRequest[T["type"]];

/** Worker-to-page broadcasts (fire and forget). */
export interface DataChangedBroadcast {
  type: "data-changed";
  /** Ids touched, so a page can refresh just those rows. */
  ids: string[];
}

export type BroadcastMessage = DataChangedBroadcast;

export function isPing(value: unknown): value is PingRequest {
  return typeof value === "object" && value !== null && (value as PingRequest).type === "ping";
}
