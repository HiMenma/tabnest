import { type DragEvent, type ReactElement, useEffect, useRef, useState } from "react";
import { type Id, type Node, QUICK_LIST_ID, ROOT_ID, TRASH_ID } from "../../../../data/model";
import { actions, reportError } from "../../../data/actions";
import { ARCHIVE_VIEW, childrenOf, countTabs, isRenamable } from "../../../data/tree";
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
  onRename: (id: Id, label: string) => void;
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
  onRename,
  onDropInto,
}: RowProps) {
  const [over, setOver] = useState(false);
  const [editing, setEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const isGroup = node.kind === "group";
  const count = isGroup ? countTabs(map, node.id) : 0;
  const canExpand = isGroup && node.groupType !== "trash" && childrenOf(map, node.id).length > 0;
  const isOpen = expanded.has(node.id);
  const renamable = isRenamable(node);
  const label = labelOf(node);

  useEffect(() => {
    if (!editing) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [editing]);

  const commit = (value: string): void => {
    setEditing(false);
    const trimmed = value.trim();
    if (!trimmed || trimmed === label) return;
    onRename(node.id, trimmed);
  };

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
        onDoubleClick={(event) => {
          if (!renamable) return;
          event.preventDefault();
          setEditing(true);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onSelect(node.id);
          }
          if (event.key === "F2" && renamable) {
            event.preventDefault();
            setEditing(true);
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
        title={editing ? undefined : label}
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

        {editing ? (
          <input
            ref={inputRef}
            className="tn-side-edit"
            defaultValue={label}
            aria-label={label}
            onClick={(event) => event.stopPropagation()}
            onDoubleClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === "Enter") commit(event.currentTarget.value);
              if (event.key === "Escape") setEditing(false);
            }}
            onBlur={(event) => commit(event.currentTarget.value)}
          />
        ) : (
          <span className="tn-side-label">{label}</span>
        )}

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
                onRename={onRename}
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

  const onRename = (id: Id, label: string): void => {
    void actions.renameGroup(id, label);
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

  const systemRow = (
    id: Id,
    glyph: string,
    label: string,
    count: number,
    expandable = false,
  ): ReactElement => (
    <div
      role="treeitem"
      tabIndex={0}
      aria-selected={selectedId === id}
      className={`tn-side-row tn-side-row--system${selectedId === id ? " tn-side-row--active" : ""}`}
      onClick={() => onSelect(id)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect(id);
        }
      }}
      onDragOver={(event) => {
        if (id === ARCHIVE_VIEW) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
      }}
      onDrop={(event) => onDropInto(id, event)}
    >
      {expandable ? (
        <button
          type="button"
          className="tn-side-caret"
          aria-label={expanded.has(ROOT_ID) ? "Collapse" : "Expand"}
          onClick={(event) => {
            event.stopPropagation();
            toggle(id);
          }}
        >
          {expanded.has(id) ? "▾" : "▸"}
        </button>
      ) : (
        <span className="tn-side-caret" aria-hidden="true">
          {glyph}
        </span>
      )}
      <span className="tn-side-label">{label}</span>
      <span className="tn-side-count">{count || ""}</span>
    </div>
  );

  return (
    <div className="tn-sidebar" role="tree" aria-label={t("nav.collections")}>
      {systemRow(QUICK_LIST_ID, "★", t("nav.quickList"), quickCount)}
      {systemRow(ROOT_ID, "▾", t("nav.allLists"), 0, true)}

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
                onRename={onRename}
                onDropInto={onDropInto}
              />
            ))
        : null}

      <div className="tn-side-spacer" />

      {systemRow(ARCHIVE_VIEW, "▣", t("nav.archive"), archivedCount)}
      {systemRow(TRASH_ID, "🗑", t("nav.trash"), trashCount)}
    </div>
  );
}
