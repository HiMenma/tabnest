# Architecture

## What TabNest is

A tab manager for Chrome: you **park** the tabs of a window, a tab group, or a
selection into a list, and Chrome closes them. The lists live in an in-browser
database, organised in a tree of folders and groups, searchable, restorable
later — individually, as a group, or into a new window.

Sync is the differentiator: the library can be replicated to a storage backend
the user chooses, optionally encrypted with a passphrase they hold.

## Non-goals

- No cloud service operated by this project. There is no first-party server and
  no account system.
- No telemetry, no analytics, no remote code.
- No "share to a public web page" in v1. Export to HTML/JSON covers the use case
  that does not require a server with moderation obligations.

## Process model

| Context        | File                   | Responsibility                                                  |
| -------------- | ---------------------- | --------------------------------------------------------------- |
| Service worker | `src/background/`      | capture rules, repository writes, messaging router, sync engine |
| Library page   | `src/ui/pages/library` | full UI: tree, list, search, editing                            |
| Popup          | `src/ui/pages/popup`   | the "what should I park" chooser                                |
| Options        | `src/ui/pages/options` | settings                                                        |
| Sync page      | `src/ui/pages/sync`    | backend configuration, status, devices                          |

Pages never hold the only copy of anything: they read through the repository and
re-read on `data-changed` broadcasts. The service worker is the only writer, so
there is exactly one place where a mutation can be journalled for sync.

## Data model

Two record kinds in one store, both addressed by a content-derived id:

```ts
type Id = string; // base64url(sha256(canonicalUrl)).slice(0, 22) — 132 bits

interface Base {
  id: Id;
  createdAt: number;
  updatedAt: number;
  parents: Id[];
}

interface TabItem extends Base {
  kind: "tab";
  url: string; // as captured
  title: string;
  host: string; // lowercased host, kept denormalised for grouping/search
  notes?: string;
  rating?: 0 | 1 | 2 | 3 | 4 | 5;
  archivedAt?: number;
}

interface Group extends Base {
  kind: "group";
  groupType: "root" | "quickList" | "trash" | "folder" | "window" | "tabGroup";
  label?: string;
  children: Id[];
  pinnedCount?: number;
  color?: string;
}
```

### Why the id is derived from the URL

`sha256(canonicalUrl)` truncated to 22 base64url characters gives a stable
identity that every device computes the same way. Consequences:

- parking the same URL twice collapses onto one record (dedupe for free);
- two devices converge on the same ids without exchanging them;
- **cost**: editing a URL means creating a new record and merging the old one's
  fields — the repository does that in a single transaction.

### Why `parents` is an array

A tab can sit in a folder _and_ the quick list _and_ a window group. Moving is a
`parents` rewrite, not a copy, so there are no duplicate records to reconcile.
`children` keeps order; the invariant maintained by the repository is:

> for every id in `group.children`, `node.parents` contains `group.id`, and vice
> versa for every id in `node.parents` that refers to a group.

Violations are repaired by `repo.repair()`, which the sync engine calls after
applying a remote batch.

## Storage

IndexedDB database `tabnest`, version 1:

| Store       | Key          | Indexes                          | Contents                                 |
| ----------- | ------------ | -------------------------------- | ---------------------------------------- |
| `node`      | `id`         | `kind`, `groupType`, `updatedAt` | both record kinds                        |
| `meta`      | `key`        | —                                | settings, device identity, sync cursors  |
| `change`    | `seq` (auto) | `state`                          | the sync journal                         |
| `tombstone` | `id`         | `deletedAt`                      | deletion markers, expiring after 90 days |

Seeded on first run: `root`, `quickList`, `trash` groups.

Schema changes require a version bump plus a migration function; the version
constant lives in `src/data/idb.ts` and nowhere else.

## Capture rules

Parking a **window** takes its unpinned, non-excluded tabs in tab-strip order and
records the group with `groupType: "window"` and a label derived from the window
(if named) or the date.

| Setting           | Values                               | Effect                                                                        |
| ----------------- | ------------------------------------ | ----------------------------------------------------------------------------- |
| `pinned`          | `ignore` (default) / `park` / `stop` | are pinned tabs taken, left alone, or does parking refuse                     |
| `excludedDomains` | string[]                             | hosts never captured; matched against the canonical host with a `*.` wildcard |
| `alreadyParked`   | `skip` / `duplicate`                 | what to do with a URL already in the library                                  |
| `tabGroups`       | `respect` / `flatten`                | map Chrome tab groups to nested `tabGroup` groups or ignore them              |
| `closeAfter`      | `window` / `tabGroup` / `never`      | what gets closed once the records are committed                               |

Non-parkable URL schemes (`chrome://`, `chrome-extension://`, `about:`,
`devtools://`, `view-source:` before the inner URL, `file://` unless enabled)
are filtered out before anything is written.

A URL longer than 65 536 characters is not stored inline: it goes to a
`quarantined` meta list so a pathological page cannot wedge the whole parking
operation. The UI surfaces the count.

## URL canonicalisation

Used for dedupe and for the content-derived id. Order of operations:

1. `data:` URLs collapse to their scheme + media type prefix.
2. Split off the fragment (kept out of the identity).
3. Drop parameters that are unambiguously tracking (`utm_*`, `gclid`, `fbclid`,
   `msclkid`, `mc_cid`, `ref_src`, …) unless the host is known to need them.
4. On search-result pages, keep only the parameters that select the query
   (`q`, `p`, `query`, `wd`, …) and drop session noise.
5. Lowercase scheme and host, strip default ports, percent-encode consistently.

The rule set is data (`src/data/url-rules.ts`) so it can be tested and extended
without touching logic.

## The action menu

`menu-spec.ts` turns a snapshot of "what the user is looking at" into a list of
menu items — a pure function, so the enablement rules are unit-tested without a
browser:

```ts
buildMenuSpec({ activeHost, excluded, inTabGroup, highlightedCount, recentGroups });
```

Chrome installs menus statically, so `menus.ts` rebuilds them (debounced 150 ms)
whenever the active tab, its tab group, the highlight set, the window focus, the
exclusion list or the newest lists can have changed. Item ids are prefixed `tn-`
and `tn-recent:<id>` carries a destination. Click handling lives in `actions.ts`
and shares one scope table with the keyboard commands.

Two details worth remembering:

- a tab-group item is enabled only when the active tab has a `groupId`;
- "selected tabs" reads `tabs.query({ highlighted: true })`, because a tab-strip
  multi-selection has no dedicated API.

## Messaging

One typed channel, defined in `src/types/messages.ts`:

```
page --request--> worker      { type: "park-window" | "search" | ... }
worker --broadcast--> pages   { type: "data-changed", ids: [...] }
```

Requests are a discriminated union; responses are keyed by request type so a
mismatch is a compile error. Broadcasts are fire-and-forget. Sync status is a
broadcast (`{ type: "sync-status" }`) so every surface shows the same state.

## Decisions worth remembering

| Decision                                                | Rationale                                                               |
| ------------------------------------------------------- | ----------------------------------------------------------------------- |
| Deep module for the repository, no ORM                  | the tree invariants are the hard part; hide them behind `repo`          |
| Content-derived ids                                     | dedupe and convergence without negotiation                              |
| Journal written in the same transaction as the mutation | a crash can never lose a change nor duplicate one                       |
| `ObjectStore` interface for sync                        | five very different backends behind one contract                        |
| No content script on all sites                          | `activeTab` + `scripting` only, at the moment the user asks for a title |
| Local `_favicon` API, never a third-party icon service  | the icon path would otherwise leak every parked URL                     |

## Failure behaviour

- Parking is all-or-nothing per operation: records are committed in one
  transaction, then tabs are closed. A failed commit closes nothing.
- Closing tabs is best-effort: if Chrome refuses to close one, the record still
  exists and the UI reports the leftover.
- Sync never deletes local data to satisfy a remote state; conflicts resolve to
  the newer record, and local-only records are kept.
