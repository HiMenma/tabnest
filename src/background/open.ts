/**
 * Opening records back into tabs.
 *
 * Ids may name groups; a group expands to every tab underneath it in child
 * order, which is what makes "restore this window" reproduce the strip.
 */

import type { Id, Node } from "../data/model";
import { listNodes } from "../data/repo";

function collectTabs(nodes: Map<Id, Node>, rootId: Id, out: string[]): void {
  const node = nodes.get(rootId);
  if (!node) return;
  if (node.kind === "tab") {
    out.push(node.url);
    return;
  }
  for (const childId of node.children) collectTabs(nodes, childId, out);
}

export interface OpenOptions {
  mode: "current" | "tab" | "window";
  /** Chrome window to open tabs into; defaults to the current one. */
  windowId?: number;
}

export async function expandToUrls(ids: readonly Id[]): Promise<string[]> {
  const nodes = new Map((await listNodes()).map((node) => [node.id, node]));
  const urls: string[] = [];
  for (const id of ids) collectTabs(nodes, id, urls);
  // A URL can legitimately appear twice (two groups sharing a record); keep it.
  return urls;
}

export async function openNodes(ids: readonly Id[], options: OpenOptions): Promise<number> {
  const urls = await expandToUrls(ids);
  if (urls.length === 0) return 0;

  if (options.mode === "window") {
    await chrome.windows.create({ url: urls, focused: true });
    return urls.length;
  }

  if (options.mode === "current") {
    const [first, ...rest] = urls;
    if (first === undefined) return 0;
    const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (active?.id !== undefined) await chrome.tabs.update(active.id, { url: first });
    else await chrome.tabs.create({ url: first, active: true });
    for (const url of rest) {
      await chrome.tabs.create({
        url,
        active: false,
        ...(options.windowId === undefined ? {} : { windowId: options.windowId }),
      });
    }
    return urls.length;
  }

  for (const url of urls) {
    await chrome.tabs.create({
      url,
      active: false,
      ...(options.windowId === undefined ? {} : { windowId: options.windowId }),
    });
  }
  return urls.length;
}
