import { useEffect, useState } from "react";
import { send } from "../../data/client";
import { initLocale, t } from "../../i18n";
import { mount } from "../../mount";
import { applyTheme } from "../../shared/theme";

initLocale();

const SHORTCUT_COMMANDS = [
  "display-library",
  "park-current-tab",
  "park-window",
  "park-tab-group",
  "park-all-except-current",
  "park-left",
  "park-right",
  "park-all-windows",
] as const;

const SCOPES = [
  "currentTab",
  "window",
  "tabGroup",
  "allExceptCurrent",
  "left",
  "right",
  "allWindows",
  "selection",
] as const;

function HelpApp() {
  const [shortcuts, setShortcuts] = useState<Record<string, string>>({});
  const version = chrome.runtime.getManifest().version;

  useEffect(() => {
    void send({ type: "settings" })
      .then((settings) => applyTheme(settings.theme))
      .catch(() => undefined);

    void chrome.commands.getAll().then((commands) => {
      const map: Record<string, string> = {};
      for (const command of commands) {
        if (command.name && command.shortcut) map[command.name] = command.shortcut;
      }
      setShortcuts(map);
    });
  }, []);

  const open = (path: string): void => {
    void chrome.tabs.create({ url: chrome.runtime.getURL(path) });
  };

  return (
    <div className="tn-page">
      <header className="tn-page-head">
        <img src="/icons/icon32.png" alt="" width={22} height={22} />
        <div>
          <h1>{t("help.title")}</h1>
          <p className="tn-hint">{t("help.subtitle")}</p>
        </div>
        <span className="tn-hint">{t("help.version", { version })}</span>
      </header>

      <section className="tn-section">
        <h2>{t("help.gettingStarted")}</h2>
        <ol className="tn-help-steps">
          <li>{t("help.step1")}</li>
          <li>{t("help.step2")}</li>
          <li>{t("help.step3")}</li>
        </ol>
      </section>

      <section className="tn-section">
        <h2>{t("help.scopes")}</h2>
        <ul className="tn-help-list">
          {SCOPES.map((scope) => (
            <li key={scope}>{t(`help.scope.${scope}`)}</li>
          ))}
        </ul>
      </section>

      <section className="tn-section">
        <h2>{t("help.shortcuts")}</h2>
        <table className="tn-help-table">
          <tbody>
            {SHORTCUT_COMMANDS.map((command) => (
              <tr key={command}>
                <td>{t(`help.command.${command}`)}</td>
                <td>
                  <code>{shortcuts[command] ?? "—"}</code>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="tn-hint" style={{ marginBottom: 0 }}>
          {t("help.shortcutHint")}
        </p>
      </section>

      <section className="tn-section">
        <h2>{t("help.data")}</h2>
        <p className="tn-hint" style={{ marginTop: 0 }}>
          {t("help.dataBody")}
        </p>
      </section>

      <section className="tn-section">
        <h2>{t("help.links")}</h2>
        <div className="tn-button-row">
          <button type="button" className="tn-btn" onClick={() => open("pages/library.html")}>
            {t("help.openLibrary")}
          </button>
          <button type="button" className="tn-btn" onClick={() => open("pages/import.html")}>
            {t("help.openImport")}
          </button>
          <button type="button" className="tn-btn" onClick={() => open("pages/sync.html")}>
            {t("help.openSync")}
          </button>
          <button type="button" className="tn-btn" onClick={() => open("pages/options.html")}>
            {t("help.openOptions")}
          </button>
        </div>
      </section>
    </div>
  );
}

mount(<HelpApp />);
