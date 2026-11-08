import { useState } from "react";
import type { Id, Node, TabItem } from "../../../../data/model";
import { ancestorsOf } from "../../../data/tree";
import { t } from "../../../i18n";

interface DetailProps {
  map: Map<Id, Node>;
  tab: TabItem;
  onSaveTitle: (id: Id, title: string) => void;
  onSaveNotes: (id: Id, notes: string) => void;
  onSaveRating: (id: Id, rating: number) => void;
  onSaveUrl: (id: Id, url: string) => void;
  onOpen: (id: Id) => void;
  onArchive: (id: Id, archived: boolean) => void;
}

export function Detail({
  map,
  tab,
  onSaveTitle,
  onSaveNotes,
  onSaveRating,
  onSaveUrl,
  onOpen,
  onArchive,
}: DetailProps) {
  const [title, setTitle] = useState(tab.title);
  const [notes, setNotes] = useState(tab.notes ?? "");
  const [url, setUrl] = useState(tab.url);

  const trail = ancestorsOf(map, tab.id)
    .filter((node) => node.kind === "group" && node.label)
    .map((node) => (node.kind === "group" ? node.label : ""))
    .filter(Boolean)
    .join(" / ");

  return (
    <aside className="tn-detail" aria-label={t("detail.title")}>
      <h2 className="tn-detail-title">{t("detail.title")}</h2>
      {trail ? <p className="tn-detail-trail">{trail}</p> : null}

      <label className="tn-field">
        <span>{t("detail.fieldTitle")}</span>
        <input
          value={title}
          onChange={(event) => setTitle(event.currentTarget.value)}
          onBlur={(event) => {
            const next = event.currentTarget.value;
            if (next !== tab.title) onSaveTitle(tab.id, next);
            else setTitle(next);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
        />
      </label>

      <label className="tn-field">
        <span>{t("detail.fieldUrl")}</span>
        <input
          value={url}
          spellCheck={false}
          onChange={(event) => setUrl(event.currentTarget.value)}
          onBlur={(event) => {
            const next = event.currentTarget.value;
            if (next !== tab.url) onSaveUrl(tab.id, next);
            else setUrl(next);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
        />
        <small className="tn-faint">{t("detail.urlHint")}</small>
      </label>

      <label className="tn-field">
        <span>{t("detail.fieldNotes")}</span>
        <textarea
          rows={5}
          value={notes}
          placeholder={t("detail.notesPlaceholder")}
          onChange={(event) => setNotes(event.currentTarget.value)}
          onBlur={(event) => {
            const next = event.currentTarget.value;
            if (next !== (tab.notes ?? "")) onSaveNotes(tab.id, next);
            else setNotes(next);
          }}
        />
      </label>

      <div className="tn-field">
        <span>{t("detail.fieldRating")}</span>
        <div className="tn-rating-row">
          {[1, 2, 3, 4, 5].map((value) => (
            <button
              key={value}
              type="button"
              className={`tn-star${(tab.rating ?? 0) >= value ? " tn-star--on" : ""}`}
              aria-label={`${value} star${value === 1 ? "" : "s"}`}
              onClick={() => onSaveRating(tab.id, tab.rating === value ? 0 : value)}
            >
              ★
            </button>
          ))}
        </div>
      </div>

      <div className="tn-detail-actions">
        <button type="button" className="tn-btn tn-btn--primary" onClick={() => onOpen(tab.id)}>
          {t("detail.open")}
        </button>
        <button
          type="button"
          className="tn-btn"
          onClick={() => onArchive(tab.id, tab.archivedAt === undefined)}
        >
          {tab.archivedAt === undefined ? t("detail.archive") : t("detail.unarchive")}
        </button>
      </div>
    </aside>
  );
}
