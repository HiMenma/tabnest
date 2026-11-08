interface ToolbarProps {
  query: string;
  onQuery: (query: string) => void;
  selectionCount: number;
  inTrash: boolean;
  onParkWindow: () => void;
  onParkTab: () => void;
  onNewFolder: () => void;
  onOpenSelected: () => void;
  onArchiveSelected: () => void;
  onDeleteSelected: () => void;
  onRestoreSelected: () => void;
  onEmptyTrash: () => void;
}

export function Toolbar({
  query,
  onQuery,
  selectionCount,
  inTrash,
  onParkWindow,
  onParkTab,
  onNewFolder,
  onOpenSelected,
  onArchiveSelected,
  onDeleteSelected,
  onRestoreSelected,
  onEmptyTrash,
}: ToolbarProps) {
  const hasSelection = selectionCount > 0;

  return (
    <div className="tn-toolbar">
      <button type="button" className="tn-btn tn-btn--primary" onClick={onParkWindow}>
        Park this window
      </button>
      <button type="button" className="tn-btn" onClick={onParkTab}>
        Park current tab
      </button>
      <button type="button" className="tn-btn" onClick={onNewFolder} disabled={inTrash}>
        New folder
      </button>

      <div className="tn-toolbar-gap" />

      <input
        className="tn-search"
        type="search"
        value={query}
        placeholder="Search titles, URLs, notes…"
        onChange={(event) => onQuery(event.currentTarget.value)}
        aria-label="Search the library"
      />

      <div className="tn-toolbar-actions">
        {hasSelection ? (
          <span className="tn-selection-count">{selectionCount} selected</span>
        ) : null}
        <button type="button" className="tn-btn" onClick={onOpenSelected} disabled={!hasSelection}>
          Open
        </button>
        {inTrash ? (
          <>
            <button
              type="button"
              className="tn-btn"
              onClick={onRestoreSelected}
              disabled={!hasSelection}
            >
              Restore
            </button>
            <button type="button" className="tn-btn tn-btn--danger" onClick={onEmptyTrash}>
              Empty trash
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className="tn-btn"
              onClick={onArchiveSelected}
              disabled={!hasSelection}
            >
              Archive
            </button>
            <button
              type="button"
              className="tn-btn tn-btn--danger"
              onClick={onDeleteSelected}
              disabled={!hasSelection}
            >
              Trash
            </button>
          </>
        )}
      </div>
    </div>
  );
}
