import { type DragEvent, useEffect, useMemo, useRef } from "react";
import { mount } from "../../mount";
import "./library.css";
import {
  type Id,
  type Node,
  QUICK_LIST_ID,
  ROOT_ID,
  type TabItem,
  TRASH_ID,
} from "../../../data/model";
import { actions } from "../../data/actions";
import { parseGroupParam } from "../../data/deep-link";
import { startBroadcastBridge, useLibrary } from "../../data/store";
import {
  ARCHIVE_VIEW,
  buildMap,
  childrenOf,
  countTabs,
  directTabs,
  searchTabs,
} from "../../data/tree";
import { initLocale, t, tCount } from "../../i18n";
import { applyTheme } from "../../shared/theme";
import { Detail } from "./components/Detail";
import { List } from "./components/List";
import { Sidebar } from "./components/Sidebar";
import { Toolbar } from "./components/Toolbar";

initLocale();

function headingFor(map: Map<Id, Node>, id: Id): string {
  if (id === ROOT_ID) return t("nav.allLists");
  if (id === QUICK_LIST_ID) return t("nav.quickList");
  if (id === TRASH_ID) return t("nav.trash");
  if (id === ARCHIVE_VIEW) return t("nav.archive");
  const node = map.get(id);
  return node?.kind === "group" ? (node.label ?? t("nav.folder")) : t("app.name");
}

function LibraryApp() {
  const snapshot = useLibrary((state) => state.snapshot);
  const selectedGroupId = useLibrary((state) => state.selectedGroupId);
  const query = useLibrary((state) => state.query);
  const selection = useLibrary((state) => state.selection);
  const error = useLibrary((state) => state.error);
  const refresh = useLibrary((state) => state.refresh);
  const selectGroup = useLibrary((state) => state.selectGroup);
  const setQuery = useLibrary((state) => state.setQuery);
  const setSelection = useLibrary((state) => state.setSelection);
  const toggleSelection = useLibrary((state) => state.toggleSelection);
  const clearSelection = useLibrary((state) => state.clearSelection);
  const setError = useLibrary((state) => state.setError);

  const map = useMemo(() => buildMap(snapshot), [snapshot]);
  const archived = useMemo(
    () =>
      (snapshot?.nodes ?? [])
        .filter((node): node is TabItem => node.kind === "tab" && node.archivedAt !== undefined)
        .sort((a, b) => (b.archivedAt ?? 0) - (a.archivedAt ?? 0)),
    [snapshot],
  );

  const inArchive = selectedGroupId === ARCHIVE_VIEW;
  const inTrash = selectedGroupId === TRASH_ID;

  const rows: Node[] = useMemo(
    () => (inArchive ? archived : childrenOf(map, selectedGroupId)),
    [inArchive, archived, map, selectedGroupId],
  );

  const hits = useMemo(() => (query.trim() ? searchTabs(map, query) : undefined), [map, query]);
  const visibleIds = useMemo(
    () => (hits ? hits.map((hit) => hit.node.id) : rows.map((node) => node.id)),
    [hits, rows],
  );
  const lastClicked = useRef<number | null>(null);

  useEffect(() => {
    void refresh();
    return startBroadcastBridge();
  }, [refresh]);

  // `library.html?group=<id>` from the menu's recent-lists submenu.
  const deepLinkApplied = useRef(false);
  useEffect(() => {
    if (deepLinkApplied.current || !snapshot) return;
    deepLinkApplied.current = true;
    const id = parseGroupParam(window.location.search);
    if (id && map.get(id)?.kind === "group") selectGroup(id);
  }, [snapshot, map, selectGroup]);

  useEffect(() => {
    applyTheme(snapshot?.settings.theme);
  }, [snapshot?.settings.theme]);

  const subtitle = useMemo(() => {
    if (inArchive) return tCount("header.tabs", "header.tabsOne", archived.length);
    const tabs = directTabs(map, selectedGroupId).length;
    const groups = childrenOf(map, selectedGroupId).filter((node) => node.kind === "group").length;
    const deep = countTabs(map, selectedGroupId);
    const parts = [tCount("header.tabs", "header.tabsOne", tabs)];
    if (groups > 0) parts.push(tCount("header.groups", "header.groupsOne", groups));
    if (deep !== tabs) parts.push(t("header.total", { count: deep }));
    return parts.join(" · ");
  }, [map, selectedGroupId, inArchive, archived.length]);

  const singleTab = useMemo(() => {
    if (selection.size !== 1) return undefined;
    const [id] = [...selection];
    const node = id === undefined ? undefined : map.get(id);
    return node?.kind === "tab" ? node : undefined;
  }, [selection, map]);

  const onSelectRow = (id: Id, additive: boolean, shift: boolean): void => {
    const index = visibleIds.indexOf(id);
    if (shift && lastClicked.current !== null && index !== -1) {
      const from = Math.min(lastClicked.current, index);
      const to = Math.max(lastClicked.current, index);
      setSelection(visibleIds.slice(from, to + 1));
      return;
    }
    lastClicked.current = index === -1 ? null : index;
    toggleSelection(id, additive);
  };

  const onOpen = (id: Id): void => {
    void actions.open([id], snapshot?.settings.openIn ?? "tab");
  };

  const onRename = (id: Id, label: string): void => {
    const node = map.get(id);
    if (!node) return;
    if (node.kind === "tab") void actions.updateTitle(id, label);
    else void actions.renameGroup(id, label);
  };

  const onDragStartRow = (id: Id, event: DragEvent): void => {
    const ids = selection.has(id) && selection.size > 1 ? [...selection] : [id];
    event.dataTransfer.setData("application/x-tabnest-ids", JSON.stringify(ids));
    event.dataTransfer.effectAllowed = "move";
  };

  const onDropRow = (targetId: Id, event: DragEvent): void => {
    event.preventDefault();
    event.stopPropagation();
    const raw = event.dataTransfer.getData("application/x-tabnest-ids");
    if (!raw) return;
    let ids: Id[];
    try {
      ids = JSON.parse(raw) as Id[];
    } catch {
      return;
    }
    if (ids.length === 0) return;

    const target = map.get(targetId);
    if (!target) return;

    if (target.kind === "group") {
      void actions.move(ids, target.id);
      return;
    }

    const parentId = target.parents[0];
    const parent = parentId === undefined ? undefined : map.get(parentId);
    if (parent?.kind !== "group") return;

    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const after = event.clientY > rect.top + rect.height / 2;
    const base = parent.children.indexOf(target.id);
    const index = base === -1 ? parent.children.length : base + (after ? 1 : 0);
    void actions.move(ids, parent.id, index);
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "a") {
        event.preventDefault();
        setSelection(visibleIds);
        return;
      }
      if (event.key === "Escape") {
        clearSelection();
        if (query) setQuery("");
        return;
      }
      if (event.key === "Enter" && selection.size > 0) {
        event.preventDefault();
        void actions.open([...selection], snapshot?.settings.openIn ?? "tab");
        return;
      }
      if ((event.key === "Delete" || event.key === "Backspace") && selection.size > 0 && !inTrash) {
        event.preventDefault();
        void actions.remove([...selection], "trash");
        clearSelection();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [visibleIds, selection, inTrash, query, setSelection, clearSelection, setQuery, snapshot]);

  const selected = [...selection];

  return (
    <div className={`tn-library${singleTab ? " tn-library--with-detail" : ""}`}>
      <Sidebar
        map={map}
        selectedId={selectedGroupId}
        onSelect={selectGroup}
        archivedCount={archived.length}
      />

      <section className="tn-library-main">
        <header className="tn-header-row">
          <h1>{hits ? t("header.searchResults") : headingFor(map, selectedGroupId)}</h1>
          <span className="tn-header-sub">
            {hits ? tCount("header.matches", "header.matchesOne", hits.length) : subtitle}
          </span>
          <div className="tn-toolbar-gap" />
          <span className="tn-header-sub">
            {snapshot ? t("toolbar.stored", { count: snapshot.stats.tabs }) : t("app.loading")}
          </span>
          <nav className="tn-header-links" aria-label={t("app.name")}>
            <button
              type="button"
              className="tn-link"
              onClick={() =>
                void chrome.tabs.create({ url: chrome.runtime.getURL("pages/sync.html") })
              }
            >
              {t("sync.title")}
            </button>
            <button
              type="button"
              className="tn-link"
              onClick={() =>
                void chrome.tabs.create({ url: chrome.runtime.getURL("pages/import.html") })
              }
            >
              {t("io.title")}
            </button>
            <button
              type="button"
              className="tn-link"
              onClick={() =>
                void chrome.tabs.create({ url: chrome.runtime.getURL("pages/options.html") })
              }
            >
              {t("options.title")}
            </button>
            <button
              type="button"
              className="tn-link"
              onClick={() =>
                void chrome.tabs.create({ url: chrome.runtime.getURL("pages/help.html") })
              }
            >
              {t("menu.help")}
            </button>
          </nav>
        </header>

        <Toolbar
          query={query}
          onQuery={setQuery}
          selectionCount={selection.size}
          inTrash={inTrash}
          inArchive={inArchive}
          onParkWindow={() => void actions.parkWindow()}
          onParkTab={() => void actions.parkCurrentTab()}
          onNewFolder={() => {
            const label = window.prompt(t("header.folderName"));
            if (label) void actions.newFolder(label, selectedGroupId);
          }}
          onOpenSelected={() => void actions.open(selected, snapshot?.settings.openIn ?? "tab")}
          onArchiveSelected={() => {
            const next = !inArchive;
            for (const id of selected) void actions.setArchived(id, next);
          }}
          onDeleteSelected={() => {
            void actions.remove(selected, "trash");
            clearSelection();
          }}
          onRestoreSelected={() => {
            void actions.restore(selected);
            clearSelection();
          }}
          onEmptyTrash={() => {
            const trashed = childrenOf(map, TRASH_ID).map((node) => node.id);
            if (trashed.length === 0) return;
            void actions.remove(trashed, "purge");
          }}
        />

        {error ? (
          <button type="button" className="tn-error-bar" onClick={() => setError(null)}>
            {error} — {t("common.close")}
          </button>
        ) : null}

        <List
          rows={rows}
          hits={hits}
          selection={selection}
          onSelect={onSelectRow}
          onOpen={onOpen}
          onEnterGroup={(id) => selectGroup(id)}
          onRename={onRename}
          onToggleQuick={(id, member) => void actions.quickList(id, member)}
          onDragStartRow={onDragStartRow}
          onDropRow={onDropRow}
        />
      </section>

      {singleTab ? (
        <Detail
          key={singleTab.id}
          map={map}
          tab={singleTab}
          onSaveTitle={(id, title) => void actions.updateTitle(id, title)}
          onSaveNotes={(id, notes) => void actions.updateNotes(id, notes)}
          onSaveRating={(id, rating) => void actions.updateRating(id, rating)}
          onSaveUrl={(id, url) => void actions.updateUrl(id, url)}
          onOpen={(id) => void actions.open([id], snapshot?.settings.openIn ?? "tab")}
          onArchive={(id, archivedNow) => void actions.setArchived(id, archivedNow)}
        />
      ) : null}
    </div>
  );
}

mount(<LibraryApp />);
