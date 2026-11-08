import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import { t } from "../../../i18n";

interface EditableHeadingProps {
  label: string;
  /** False for the system views and for search results. */
  renamable: boolean;
  onRename: (next: string) => void;
  /** Moves the whole list to the trash; hidden when `renamable` is false. */
  onDelete: () => void;
}

/**
 * The list title. Renders as plain text unless the current view is a list the
 * user owns, in which case clicking it (or F2) turns it into an input.
 */
export function EditableHeading({ label, renamable, onRename, onDelete }: EditableHeadingProps) {
  const [editing, setEditing] = useState(false);
  // A rename from elsewhere (the sidebar) must not leave a stale editor open.
  // Adjusted during render rather than in an effect: React's documented way to
  // reset state when a prop changes.
  const [labelSnapshot, setLabelSnapshot] = useState(label);
  if (labelSnapshot !== label) {
    setLabelSnapshot(label);
    setEditing(false);
  }
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!editing) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [editing]);

  const commit = (value: string): void => {
    setEditing(false);
    const trimmed = value.trim();
    if (!trimmed || trimmed === label) return;
    onRename(trimmed);
  };

  const trashButton = renamable ? (
    <button
      type="button"
      className="tn-heading-delete"
      title={t("nav.deleteList")}
      aria-label={`${t("nav.deleteList")}: ${label}`}
      onClick={onDelete}
    >
      🗑
    </button>
  ) : null;

  if (editing) {
    return (
      <h1 className="tn-heading">
        <input
          ref={inputRef}
          className="tn-heading-input"
          defaultValue={label}
          aria-label={label}
          onKeyDown={(event) => {
            if (event.key === "Enter") commit(event.currentTarget.value);
            if (event.key === "Escape") setEditing(false);
          }}
          onBlur={(event) => commit(event.currentTarget.value)}
        />
        {trashButton}
      </h1>
    );
  }

  return (
    <h1 className="tn-heading">
      {renamable ? (
        <button
          type="button"
          className="tn-heading-trigger"
          title={t("header.renameHint")}
          onClick={() => setEditing(true)}
          onKeyDown={(event: KeyboardEvent<HTMLButtonElement>) => {
            if (event.key === "F2") {
              event.preventDefault();
              setEditing(true);
            }
          }}
        >
          {label}
        </button>
      ) : (
        label
      )}
      {trashButton}
    </h1>
  );
}
