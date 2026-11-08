import { type DragEvent, useState } from "react";
import { type Id, type Node, QUICK_LIST_ID, ROOT_ID, TRASH_ID } from "../../../../data/model";
import { actions, reportError } from "../../../data/actions";
import { ARCHIVE_VIEW, childrenOf, countTabs } from "../../../data/tree";
import { t } from "../../../i18n";

interface SidebarProps {
  map: Map<Id, Node>;
  selectedId: Id;
  onSelect: (id: Id) => void;
  archivedCount: number;
}

interface RowProps {
  node: Node;
  depth: number;
  map: Map<Id, Node>;
  selectedId: Id;
  onSelect: (id: Id) => void;
  expanded: Set<Id>;
  toggle: (id: Id) => void;
  onDropInto: (groupId: Id, event: DragEvent) => void;
}

function labelOf(node: Node): string {
  if (node.kind !== "group") return node.title;
  if (node.id === QUICK_LIST_ID) return t("nav.quickList");
  if (node.id === TRASH_ID) return t("nav.trash");
  if (node.id === ROOT_ID) return t("nav.allLists");
  if (node.label) return node.label;
  return node.groupType === "window" ? t("nav.window") : t("nav.folder");
}

function DropRow({
  node,
  depth,
  map,
  selectedId,
  onSelect,
  expanded,
  toggle,
  onDropInto,
}: RowProps) {
  const [over, setOver] = useState(false);
  const isGroup = node.kind === "group";
  const count = isGroup ? countTabs(map, node.id) : 0;
  const canExpand = isGroup && node.groupType !== "trash" && childrenOf(map, node.id).length > 0;
  const isOpen = expanded.has(node.id);

  return (
    <>
      <div
        role="treeitem"
        tabIndex={0}
        aria-expanded={canExpand ? isOpen : undefined}
        aria-selected={selectedId === node.id}
        className={[
          "tn-side-row",
          selectedId === node.id ? "tn-side-row--active" : "",
          over ? "tn-side-row--over" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        style={{ paddingInlineStart: 8 + depth * 12 }}
        onClick={() => onSelect(node.id)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onSelect(node.id);
          }
          if (event.key === "ArrowRight" && canExpand && !isOpen) toggle(node.id);
          if (event.key === "ArrowLeft" && canExpand && isOpen) toggle(node.id);
        }}
        onDragOver={(event) => {
          if (!isGroup || node.groupType === "trash") return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(event) => {
          setOver(false);
          onDropInto(node.id, event);
        }}
        title={labelOf(node)}
      >
        <button
          type="button"
          className="tn-side-caret"
          aria-label={isOpen ? "Collapse" : "Expand"}
          onClick={(event) => {
            event.stopPropagation();
            if (canExpand) toggle(node.id);
          }}
          style={{ visibility: canExpand ? "visible" : "hidden" }}
        >
          {isOpen ? "▾" : "▸"}
        </button>
        <span className="tn-side-label">{labelOf(node)}</span>
        <span className="tn-side-count">{count || ""}</span>
      </div>

      {isOpen && isGroup
        ? childrenOf(map, node.id)
            .filter((child) => child.kind === "group" && child.groupType !== "trash")
            .map((child) => (
              <DropRow
                key={child.id}
                node={child}
                depth={depth + 1}
                map={map}
                selectedId={selectedId}
                onSelect={onSelect}
                expanded={expanded}
                toggle={toggle}
                onDropInto={onDropInto}
              />
            ))
        : null}
    </>
  );
}

export function Sidebar({ map, selectedId, onSelect, archivedCount }: SidebarProps) {
  const [expanded, setExpanded] = useState<Set<Id>>(() => new Set<Id>([ROOT_ID]));

  const toggle = (id: Id): void => {
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const onDropInto = (groupId: Id, event: DragEvent): void => {
    event.preventDefault();
    const raw = event.dataTransfer.getData("application/x-tabnest-ids");
    if (!raw) return;
    let ids: Id[] = [];
    try {
      ids = JSON.parse(raw) as Id[];
    } catch (error) {
      reportError(error);
      return;
    }
    if (ids.length === 0) return;
    void actions.move(ids, groupId);
  };

  const rootChildren = childrenOf(map, ROOT_ID);
  const quickCount = countTabs(map, QUICK_LIST_ID);
  const trashCount = countTabs(map, TRASH_ID);

  return (
    <div className="tn-sidebar" role="tree" aria-label={t("nav.collections")}>
      <div
        role="treeitem"
        tabIndex={0}
        aria-selected={selectedId === QUICK_LIST_ID}
        className={`tn-side-row tn-side-row--system${selectedId === QUICK_LIST_ID ? " tn-side-row--active" : ""}`}
        onClick={() => onSelect(QUICK_LIST_ID)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onSelect(QUICK_LIST_ID);
          }
        }}
        onDragOver={(event) => {
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
        }}
        onDrop={(event) => onDropInto(QUICK_LIST_ID, event)}
      >
        <span className="tn-side-caret" aria-hidden="true">
          ★
        </span>
        <span className="tn-side-label">{t("nav.quickList")}</span>
        <span className="tn-side-count">{quickCount || ""}</span>
      </div>

      <div
        role="treeitem"
        tabIndex={0}
        aria-selected={selectedId === ROOT_ID}
        className={`tn-side-row tn-side-row--system${selectedId === ROOT_ID ? " tn-side-row--active" : ""}`}
        onClick={() => onSelect(ROOT_ID)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onSelect(ROOT_ID);
          }
        }}
      >
        <button
          type="button"
          className="tn-side-caret"
          aria-label={expanded.has(ROOT_ID) ? "Collapse" : "Expand"}
          onClick={(event) => {
            event.stopPropagation();
            toggle(ROOT_ID);
          }}
        >
          {expanded.has(ROOT_ID) ? "▾" : "▸"}
        </button>
        <span className="tn-side-label">{t("nav.allLists")}</span>
      </div>

      {expanded.has(ROOT_ID)
        ? rootChildren
            .filter((child) => child.kind === "group" && child.groupType !== "trash")
            .map((child) => (
              <DropRow
                key={child.id}
                node={child}
                depth={1}
                map={map}
                selectedId={selectedId}
                onSelect={onSelect}
                expanded={expanded}
                toggle={toggle}
                onDropInto={onDropInto}
              />
            ))
        : null}

      <div className="tn-side-spacer" />

      <div
        role="treeitem"
        tabIndex={0}
        aria-selected={selectedId === ARCHIVE_VIEW}
        className={`tn-side-row tn-side-row--system${selectedId === ARCHIVE_VIEW ? " tn-side-row--active" : ""}`}
        onClick={() => onSelect(ARCHIVE_VIEW)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onSelect(ARCHIVE_VIEW);
          }
        }}
      >
        <span className="tn-side-caret" aria-hidden="true">
          ▣
        </span>
        <span className="tn-side-label">{t("nav.archive")}</span>
        <span className="tn-side-count">{archivedCount || ""}</span>
      </div>

      <div
        role="treeitem"
        tabIndex={0}
        aria-selected={selectedId === TRASH_ID}
        className={`tn-side-row tn-side-row--system${selectedId === TRASH_ID ? " tn-side-row--active" : ""}`}
        onClick={() => onSelect(TRASH_ID)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onSelect(TRASH_ID);
          }
        }}
        onDragOver={(event) => {
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
        }}
        onDrop={(event) => onDropInto(TRASH_ID, event)}
      >
        <span className="tn-side-caret" aria-hidden="true">
          🗑
        </span>
        <span className="tn-side-label">{t("nav.trash")}</span>
        <span className="tn-side-count">{trashCount || ""}</span>
      </div>
    </div>
  );
}
