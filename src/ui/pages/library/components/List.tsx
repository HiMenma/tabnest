import { type DragEvent, useEffect, useRef, useState } from "react";
import type { Id, Node, TabItem } from "../../../../data/model";
import type { SearchHit } from "../../../data/tree";
import { formatDate } from "../../../data/tree";
import { t, tCount } from "../../../i18n";
import { useVirtual } from "../../../shared/useVirtual";

const ROW_HEIGHT = 30;

function Favicon({ url }: { url: string }) {
  const [failed, setFailed] = useState(false);
  const host = (() => {
    try {
      return new URL(url).hostname.replace(/^www\./, "");
    } catch {
      return "";
    }
  })();

  if (failed || !host) {
    return (
      <span className="tn-favicon tn-favicon--letter" aria-hidden="true">
        {(host[0] ?? "?").toUpperCase()}
      </span>
    );
  }

  // Chrome's local favicon cache: no third party ever sees these URLs.
  const source = `${chrome.runtime.getURL("/_favicon/")}?pageUrl=${encodeURIComponent(url)}&size=16`;
  return (
    <img
      className="tn-favicon"
      src={source}
      alt=""
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}

function Stars({ rating }: { rating: number }) {
  if (!rating) return null;
  return (
    <span className="tn-stars" title={`${rating} / 5`}>
      {"★".repeat(rating)}
    </span>
  );
}

interface RowProps {
  node: Node;
  selected: boolean;
  onSelect: (id: Id, additive: boolean, shift: boolean) => void;
  onOpen: (id: Id) => void;
  onEnterGroup: (id: Id) => void;
  onRename: (id: Id, title: string) => void;
  onToggleQuick: (id: Id, member: boolean) => void;
  onDragStartRow: (id: Id, event: DragEvent) => void;
  onDropRow: (id: Id, event: DragEvent) => void;
  trail?: string;
}

function Row({
  node,
  selected,
  onSelect,
  onOpen,
  onEnterGroup,
  onRename,
  onToggleQuick,
  onDragStartRow,
  onDropRow,
  trail,
}: RowProps) {
  const [editing, setEditing] = useState(false);
  const [over, setOver] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  const isTab = node.kind === "tab";
  const tab = isTab ? (node as TabItem) : undefined;
  const label = isTab ? (tab?.title ?? "") : node.kind === "group" ? (node.label ?? "Folder") : "";
  const childCount = isTab ? 0 : (node as { children: Id[] }).children.length;
  const inQuickList = (tab?.parents ?? []).includes("quickList");
  const isArchived = tab?.archivedAt !== undefined;

  const commit = (value: string): void => {
    setEditing(false);
    const trimmed = value.trim();
    if (!trimmed || trimmed === label) return;
    onRename(node.id, trimmed);
  };

  const activate = (): void => {
    if (isTab) onOpen(node.id);
    else onEnterGroup(node.id);
  };

  // A row is a group of controls (checkbox, title button, quick-list toggle)
  // rather than one interactive element, which is why it is not role="option".
  // The row-level click is a mouse shortcut: every action it offers is also
  // reachable from a focusable child.
  return (
    // The row carries pointer shortcuts only; the checkbox selects and the title
    // button opens, so every action is reachable without a mouse.
    // biome-ignore lint/a11y/useKeyWithClickEvents lint/a11y/noStaticElementInteractions: pointer shortcut on a row whose actions are keyboard-reachable.
    <div
      className={[
        "tn-row-item",
        selected ? "tn-row-item--selected" : "",
        over ? "tn-row-item--over" : "",
        isTab ? "" : "tn-row-item--group",
        isArchived ? "tn-row-item--archived" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      draggable={!editing}
      onDragStart={(event) => onDragStartRow(node.id, event)}
      onDragOver={(event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        setOver(false);
        onDropRow(node.id, event);
      }}
      onClick={(event) => onSelect(node.id, event.metaKey || event.ctrlKey, event.shiftKey)}
      onDoubleClick={activate}
    >
      <input
        type="checkbox"
        className="tn-check"
        checked={selected}
        onChange={() => onSelect(node.id, true, false)}
        onClick={(event) => event.stopPropagation()}
        aria-label={`Select ${label}`}
      />

      {isTab && tab ? <Favicon url={tab.url} /> : <span className="tn-folder-ico">▸</span>}

      <div className="tn-row-main">
        {editing ? (
          <input
            ref={inputRef}
            className="tn-inline-input"
            defaultValue={label}
            aria-label={label}
            onKeyDown={(event) => {
              if (event.key === "Enter") commit(event.currentTarget.value);
              if (event.key === "Escape") setEditing(false);
            }}
            onBlur={(event) => commit(event.currentTarget.value)}
            onClick={(event) => event.stopPropagation()}
          />
        ) : (
          // A real button so the row is keyboard-operable without nesting
          // interactive elements inside another interactive role. Mouse clicks
          // bubble to the row and select; Enter or Space opens.
          <button
            type="button"
            className="tn-row-title tn-row-open"
            title={label}
            onClick={() => undefined}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                event.stopPropagation();
                activate();
              }
              if (event.key === "F2") {
                event.preventDefault();
                setEditing(true);
              }
            }}
          >
            {label}
          </button>
        )}
        {!isTab && trail === undefined ? (
          <span className="tn-row-sub">{tCount("row.items", "row.itemOne", childCount)}</span>
        ) : null}
        {isTab && trail ? <span className="tn-row-sub">{trail}</span> : null}
      </div>

      {isTab && tab ? (
        <>
          <span className="tn-row-host">{tab.host.replace(/^www\./, "")}</span>
          <Stars rating={tab.rating ?? 0} />
          {tab.notes ? (
            <span className="tn-note-dot" title={tab.notes}>
              ✎
            </span>
          ) : null}
          <button
            type="button"
            className={`tn-quick${inQuickList ? " tn-quick--on" : ""}`}
            title="Toggle quick list"
            onClick={(event) => {
              event.stopPropagation();
              onToggleQuick(node.id, !inQuickList);
            }}
          >
            ★
          </button>
          {isArchived ? <span className="tn-archived-badge">{t("row.archived")}</span> : null}
          <span className="tn-row-date">{formatDate(tab.createdAt)}</span>
        </>
      ) : (
        <span className="tn-row-date">{formatDate(node.createdAt)}</span>
      )}
    </div>
  );
}

interface ListProps {
  rows: Node[];
  hits?: SearchHit[] | undefined;
  selection: ReadonlySet<Id>;
  onSelect: (id: Id, additive: boolean, shift: boolean) => void;
  onOpen: (id: Id) => void;
  onEnterGroup: (id: Id) => void;
  onRename: (id: Id, title: string) => void;
  onToggleQuick: (id: Id, member: boolean) => void;
  onDragStartRow: (id: Id, event: DragEvent) => void;
  onDropRow: (id: Id, event: DragEvent) => void;
}

export function List({
  rows,
  hits,
  selection,
  onSelect,
  onOpen,
  onEnterGroup,
  onRename,
  onToggleQuick,
  onDragStartRow,
  onDropRow,
}: ListProps) {
  const entries: { node: Node; trail?: string }[] = hits
    ? hits.map((hit) => ({ node: hit.node, trail: hit.trail }))
    : rows.map((node) => ({ node }));

  const { ref, range, onScroll, totalHeight, rowHeight } = useVirtual(entries.length, ROW_HEIGHT);

  if (entries.length === 0) {
    return (
      <div className="tn-empty tn-list-empty">
        {hits ? t("empty.noMatches") : t("empty.noRecords")}
      </div>
    );
  }

  return (
    <div className="tn-list-view" ref={ref} onScroll={onScroll} tabIndex={-1}>
      <ul
        className="tn-listbox"
        aria-label={t("list.records")}
        style={{ height: totalHeight, position: "relative" }}
      >
        {entries.slice(range.start, range.end).map((entry, offset) => (
          <li
            key={entry.node.id}
            style={{
              position: "absolute",
              top: (range.start + offset) * rowHeight,
              left: 0,
              right: 0,
              height: rowHeight,
            }}
          >
            <Row
              node={entry.node}
              selected={selection.has(entry.node.id)}
              onSelect={onSelect}
              onOpen={onOpen}
              onEnterGroup={onEnterGroup}
              onRename={onRename}
              onToggleQuick={onToggleQuick}
              onDragStartRow={onDragStartRow}
              onDropRow={onDropRow}
              {...(entry.trail === undefined ? {} : { trail: entry.trail })}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}
