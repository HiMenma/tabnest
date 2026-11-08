import { useEffect, useState } from "react";
import { mount } from "../../mount";
import "../../options.css";
import { send } from "../../data/client";
import { downloadFile, toExportDocument, toHtml } from "../../data/export";
import { dedupe, flattenBookmarks, type ImportItem, parseJson, parseText } from "../../data/import";
import { initLocale, t } from "../../i18n";

initLocale();

function ImportApp() {
  const [text, setText] = useState("");
  const [label, setLabel] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const defaultLabel = `Imported ${new Date().toISOString().slice(0, 10)}`;

  useEffect(() => {
    setLabel(defaultLabel);
  }, [defaultLabel]);

  const runImport = async (items: ImportItem[]): Promise<void> => {
    const unique = dedupe(items);
    if (unique.length === 0) {
      setStatus(t("io.imported", { count: 0 }));
      return;
    }
    setBusy(true);
    try {
      const result = await send({
        type: "import",
        items: unique.map((item) => ({
          url: item.url,
          ...(item.title === undefined ? {} : { title: item.title }),
        })),
        label: label.trim() || defaultLabel,
      });
      const parts = [t("io.imported", { count: result.added })];
      if (result.skipped > 0) parts.push(t("io.importSkipped", { count: result.skipped }));
      setStatus(parts.join(" "));
      setText("");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const onFile = async (file: File | undefined): Promise<void> => {
    if (!file) return;
    const content = await file.text();
    if (file.name.endsWith(".json") || content.trimStart().startsWith("[")) {
      await runImport(parseJson(content));
    } else if (file.name.endsWith(".json") || content.trimStart().startsWith("{")) {
      await runImport(parseJson(content));
    } else if (file.name.endsWith(".html")) {
      setStatus("HTML import is not supported; export as JSON from the other tool instead.");
    } else {
      await runImport(parseText(content));
    }
  };

  const importBookmarks = async (): Promise<void> => {
    const granted = await chrome.permissions.request({ permissions: ["bookmarks"] });
    if (!granted) return;
    const tree = await chrome.bookmarks.getTree();
    await runImport(flattenBookmarks(tree));
  };

  const importReadingList = async (): Promise<void> => {
    const granted = await chrome.permissions.request({ permissions: ["readingList"] });
    if (!granted) return;
    const entries = await chrome.readingList.query({});
    await runImport(entries.map((entry) => ({ url: entry.url, title: entry.title })));
  };

  const exportJson = async (): Promise<void> => {
    const snapshot = await send({ type: "snapshot" });
    downloadFile(
      `tabnest-${new Date().toISOString().slice(0, 10)}.json`,
      JSON.stringify(toExportDocument(snapshot), null, 2),
      "application/json",
    );
  };

  const exportHtml = async (): Promise<void> => {
    const snapshot = await send({ type: "snapshot" });
    downloadFile(
      `tabnest-${new Date().toISOString().slice(0, 10)}.html`,
      toHtml(snapshot),
      "text/html",
    );
  };

  return (
    <div className="tn-page">
      <header className="tn-page-head">
        <img src="/icons/icon32.png" alt="" width={22} height={22} />
        <div>
          <h1>{t("io.title")}</h1>
          <p className="tn-hint">{t("io.exportHint")}</p>
        </div>
        {status ? <span className="tn-status">{status}</span> : null}
      </header>

      <section className="tn-section">
        <h2>{t("io.import")}</h2>

        <label className="tn-setting tn-setting--stack">
          <span className="tn-setting-label">{t("io.importText")}</span>
          <textarea
            rows={7}
            spellCheck={false}
            value={text}
            onChange={(event) => setText(event.currentTarget.value)}
            placeholder={"https://example.com/article\nSome title\thttps://example.com/other"}
          />
        </label>

        <label className="tn-setting">
          <span className="tn-setting-label">{t("io.importGroup")}</span>
          <span className="tn-setting-control">
            <input
              type="text"
              value={label}
              onChange={(event) => setLabel(event.currentTarget.value)}
              style={{ maxWidth: 340, font: "inherit", padding: "5px 7px", borderRadius: 4 }}
            />
          </span>
        </label>

        <div className="tn-button-row">
          <button
            type="button"
            className="tn-btn tn-btn--primary"
            disabled={busy || text.trim().length === 0}
            onClick={() => void runImport(parseText(text))}
          >
            {t("io.importButton")}
          </button>
          <button type="button" className="tn-btn" onClick={() => void importBookmarks()}>
            {t("io.fromBookmarks")}
          </button>
          <button type="button" className="tn-btn" onClick={() => void importReadingList()}>
            {t("io.fromReadingList")}
          </button>
          <label className="tn-btn" style={{ display: "inline-flex", alignItems: "center" }}>
            {t("io.importFile")}
            <input
              type="file"
              accept=".json,.txt,.html,text/plain,application/json"
              style={{ display: "none" }}
              onChange={(event) => void onFile(event.currentTarget.files?.[0])}
            />
          </label>
        </div>
      </section>

      <section className="tn-section">
        <h2>{t("io.export")}</h2>
        <div className="tn-button-row">
          <button type="button" className="tn-btn" onClick={() => void exportJson()}>
            {t("io.exportJson")}
          </button>
          <button type="button" className="tn-btn" onClick={() => void exportHtml()}>
            {t("io.exportHtml")}
          </button>
        </div>
      </section>
    </div>
  );
}

mount(<ImportApp />);
