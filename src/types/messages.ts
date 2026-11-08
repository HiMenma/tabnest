/**
 * The message bus between extension pages and the service worker.
 *
 * One discriminated union both sides import, so a shape change is a compile
 * error rather than a runtime surprise. `ResponseByRequest` keys responses by
 * request type for the same reason.
 */

import type { ParkScope } from "../background/capture";
import type { BackendOptions } from "../background/sync/backend/types";
import type { SyncStatus } from "../background/sync/engine";
import type { Id, LibrarySnapshot, Settings } from "../data/model";

export interface PingRequest {
  type: "ping";
}

export interface PingResponse {
  ok: true;
  version: string;
  at: number;
}

export interface SnapshotRequest {
  type: "snapshot";
}

/** Just the settings, for surfaces that must not pull the whole library. */
export interface SettingsOnlyRequest {
  type: "settings";
}

export interface ParkRequest {
  type: "park";
  scope: ParkScope;
}

export interface ParkResponse {
  added: number;
  skipped: number;
  excluded: number;
  pinnedSkipped: number;
  quarantined: number;
  groupIds: Id[];
  closedTabs: number;
  refusedDueToPinned: boolean;
  summary: string;
}

export interface OpenRequest {
  type: "open";
  ids: Id[];
  mode: "current" | "tab" | "window";
}

export interface OpenResponse {
  opened: number;
}

export interface UpdateTabRequest {
  type: "update-tab";
  id: Id;
  patch: { title?: string; notes?: string; rating?: number | null; archived?: boolean };
}

export interface UpdateTabUrlRequest {
  type: "update-tab-url";
  id: Id;
  url: string;
}

export interface UpdateGroupRequest {
  type: "update-group";
  id: Id;
  patch: { label?: string };
}

export interface CreateGroupRequest {
  type: "create-group";
  label: string;
  parentId?: Id;
}

export interface MoveRequest {
  type: "move";
  ids: Id[];
  parentId: Id;
  index?: number;
}

export interface DeleteRequest {
  type: "delete";
  ids: Id[];
  mode: "trash" | "purge";
}

export interface RestoreRequest {
  type: "restore";
  ids: Id[];
}

export interface QuickListRequest {
  type: "quick-list";
  id: Id;
  member: boolean;
}

export interface SettingsRequest {
  type: "patch-settings";
  patch: Partial<Settings>;
}

export interface RepairRequest {
  type: "repair";
}

export interface ImportRequest {
  type: "import";
  items: { url: string; title?: string }[];
  label: string;
}

export interface SyncGetRequest {
  type: "sync-get";
}

export interface SyncConfigureRequest {
  type: "sync-configure";
  backendId: string;
  storeId?: string;
  options?: BackendOptions;
  passphrase?: string;
}

export interface SyncNowRequest {
  type: "sync-now";
}

export interface SyncDisableRequest {
  type: "sync-disable";
}

export type RequestMessage =
  | PingRequest
  | SnapshotRequest
  | SettingsOnlyRequest
  | ParkRequest
  | OpenRequest
  | UpdateTabRequest
  | UpdateTabUrlRequest
  | UpdateGroupRequest
  | CreateGroupRequest
  | MoveRequest
  | DeleteRequest
  | RestoreRequest
  | QuickListRequest
  | SettingsRequest
  | RepairRequest
  | ImportRequest
  | SyncGetRequest
  | SyncConfigureRequest
  | SyncNowRequest
  | SyncDisableRequest;

export interface ResponseByRequest {
  ping: PingResponse;
  snapshot: LibrarySnapshot;
  settings: Settings;
  park: ParkResponse;
  open: OpenResponse;
  "update-tab": { ok: true };
  "update-tab-url": { id: Id };
  "update-group": { ok: true };
  "create-group": { id: Id };
  move: { ok: true };
  delete: { removed: number };
  restore: { restored: number };
  "quick-list": { ok: true };
  "patch-settings": Settings;
  repair: { repaired: boolean };
  import: { added: number; skipped: number; groupId: Id };
  "sync-get": SyncStatus;
  "sync-configure": SyncStatus;
  "sync-now": SyncStatus;
  "sync-disable": SyncStatus;
}

export type ResponseFor<T extends RequestMessage> = ResponseByRequest[T["type"]];

/** A failed request never throws across the boundary; it returns this. */
export interface ErrorResponse {
  error: string;
}

/** Worker -> page broadcasts. Fire and forget. */
export interface DataChangedBroadcast {
  type: "data-changed";
  ids: Id[];
}

export interface SyncStatusBroadcast extends SyncStatus {
  type: "sync-status";
}

export type BroadcastMessage = DataChangedBroadcast | SyncStatusBroadcast;

export function isRequest(value: unknown): value is RequestMessage {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { type?: unknown }).type === "string"
  );
}

const REQUEST_TYPES = new Set<string>([
  "ping",
  "snapshot",
  "settings",
  "park",
  "open",
  "update-tab",
  "update-tab-url",
  "update-group",
  "create-group",
  "move",
  "delete",
  "restore",
  "quick-list",
  "patch-settings",
  "repair",
  "import",
  "sync-get",
  "sync-configure",
  "sync-now",
  "sync-disable",
]);

export function isKnownRequest(value: unknown): value is RequestMessage {
  return isRequest(value) && REQUEST_TYPES.has(value.type);
}
