import { t } from "../../../i18n";

interface ToolbarProps {
  query: string;
  onQuery: (query: string) => void;
  selectionCount: number;
  inTrash: boolean;
  inArchive: boolean;
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
  inArchive,
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
        {t("toolbar.parkWindow")}
      </button>
      <button type="button" className="tn-btn" onClick={onParkTab}>
        {t("toolbar.parkTab")}
      </button>
      <button
        type="button"
        className="tn-btn"
        onClick={onNewFolder}
        disabled={inTrash || inArchive}
      >
        {t("toolbar.newFolder")}
      </button>

      <div className="tn-toolbar-gap" />

      <input
        className="tn-search"
        type="search"
        value={query}
        placeholder={t("toolbar.search")}
        onChange={(event) => onQuery(event.currentTarget.value)}
        aria-label={t("toolbar.search")}
      />

      <div className="tn-toolbar-actions">
        {hasSelection ? (
          <span className="tn-selection-count">
            {t("toolbar.selected", { count: selectionCount })}
          </span>
        ) : null}
        <button type="button" className="tn-btn" onClick={onOpenSelected} disabled={!hasSelection}>
          {t("toolbar.open")}
        </button>
        {inTrash ? (
          <>
            <button
              type="button"
              className="tn-btn"
              onClick={onRestoreSelected}
              disabled={!hasSelection}
            >
              {t("toolbar.restore")}
            </button>
            <button type="button" className="tn-btn tn-btn--danger" onClick={onEmptyTrash}>
              {t("toolbar.emptyTrash")}
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
              {inArchive ? t("detail.unarchive") : t("toolbar.archive")}
            </button>
            <button
              type="button"
              className="tn-btn tn-btn--danger"
              onClick={onDeleteSelected}
              disabled={!hasSelection}
            >
              {t("toolbar.trash")}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
