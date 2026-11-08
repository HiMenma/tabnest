import type { Id, Node, TabItem } from "../../data/model";
import { send } from "./client";
import { useLibrary } from "./store";
import { childrenOf } from "./tree";

export function reportError(error: unknown): void {
  useLibrary.getState().setError(error instanceof Error ? error.message : String(error));
}

async function run(action: () => Promise<unknown>): Promise<void> {
  try {
    await action();
    await useLibrary.getState().refresh();
  } catch (error) {
    reportError(error);
  }
}

export const actions = {
  parkWindow: () => run(() => send({ type: "park", scope: { kind: "window" } })),
  parkCurrentTab: () => run(() => send({ type: "park", scope: { kind: "current-tab" } })),
  parkTabGroup: () => run(() => send({ type: "park", scope: { kind: "tab-group" } })),
  parkSelection: (tabIds: number[]) =>
    run(() => send({ type: "park", scope: { kind: "tabs", tabIds } })),

  open: (ids: Id[], mode: "current" | "tab" | "window") =>
    run(() => send({ type: "open", ids, mode })),

  updateTitle: (id: Id, title: string) =>
    run(() => send({ type: "update-tab", id, patch: { title } })),
  updateNotes: (id: Id, notes: string) =>
    run(() => send({ type: "update-tab", id, patch: { notes } })),
  updateRating: (id: Id, rating: number) =>
    run(() => send({ type: "update-tab", id, patch: { rating } })),
  updateUrl: (id: Id, url: string) => run(() => send({ type: "update-tab-url", id, url })),
  setArchived: (id: Id, archived: boolean) =>
    run(() => send({ type: "update-tab", id, patch: { archived } })),
  renameGroup: (id: Id, label: string) =>
    run(() => send({ type: "update-group", id, patch: { label } })),

  newFolder: (label: string, parentId: Id) =>
    run(() => send({ type: "create-group", label, parentId })),

  move: (ids: Id[], parentId: Id, index?: number) =>
    run(() =>
      send({
        type: "move",
        ids,
        parentId,
        ...(index === undefined ? {} : { index }),
      }),
    ),

  remove: (ids: Id[], mode: "trash" | "purge") => run(() => send({ type: "delete", ids, mode })),
  restore: (ids: Id[]) => run(() => send({ type: "restore", ids })),
  quickList: (id: Id, member: boolean) => run(() => send({ type: "quick-list", id, member })),
  repair: () => run(() => send({ type: "repair" })),
};

/** Ids selected, or the row under the cursor when nothing is selected. */
export function targetsFor(id?: Id): Id[] {
  const selection = useLibrary.getState().selection;
  if (selection.size > 0) return [...selection];
  return id === undefined ? [] : [id];
}

/**
 * Every tab id that a selection expands to. Used when parking browser tabs and
 * when deciding whether a right-click menu applies.
 */
export function expandSelection(nodes: Map<Id, Node>, ids: Id[]): Id[] {
  const out: Id[] = [];
  const visit = (nodeId: Id, depth: number): void => {
    if (depth > 32) return;
    const node = nodes.get(nodeId);
    if (!node) return;
    if (node.kind === "tab") {
      out.push(node.id);
      return;
    }
    for (const childId of node.children) visit(childId, depth + 1);
  };
  for (const id of ids) visit(id, 0);
  return out;
}

export function tabsUnder(nodes: Map<Id, Node>, id: Id): TabItem[] {
  const group = nodes.get(id);
  if (group?.kind !== "group") return [];
  return childrenOf(nodes, id).filter((node): node is TabItem => node.kind === "tab");
}
