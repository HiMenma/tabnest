import { useEffect, useState } from "react";
import type { Settings } from "../../../data/model";
import { send } from "../../data/client";
import { initLocale, t } from "../../i18n";
import { mount } from "../../mount";
import { applyTheme } from "../../shared/theme";

initLocale();

type Option = { value: string; labelKey: string };

function Select({
  label,
  hint,
  value,
  options,
  onChange,
}: {
  label: string;
  hint?: string;
  value: string;
  options: Option[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="tn-setting">
      <span className="tn-setting-label">{label}</span>
      <span className="tn-setting-control">
        <select value={value} onChange={(event) => onChange(event.currentTarget.value)}>
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {t(option.labelKey)}
            </option>
          ))}
        </select>
        {hint ? <span className="tn-hint">{hint}</span> : null}
      </span>
    </label>
  );
}

const OPTIONAL_PERMISSIONS = [
  { id: "tabGroups", labelKey: "options.grantTabGroups" },
  { id: "bookmarks", labelKey: "options.grantBookmarks" },
  { id: "readingList", labelKey: "options.grantReadingList" },
] as const;

function OptionsApp() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [excluded, setExcluded] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [granted, setGranted] = useState<Record<string, boolean>>({});

  useEffect(() => {
    send({ type: "settings" })
      .then((loaded) => {
        setSettings(loaded);
        setExcluded(loaded.excludedDomains.join("\n"));
        applyTheme(loaded.theme);
      })
      .catch((error: unknown) => setStatus(error instanceof Error ? error.message : String(error)));

    void (async () => {
      const next: Record<string, boolean> = {};
      for (const permission of OPTIONAL_PERMISSIONS) {
        next[permission.id] = await chrome.permissions.contains({
          permissions: [permission.id],
        });
      }
      setGranted(next);
    })();
  }, []);

  const patch = async (part: Partial<Settings>): Promise<void> => {
    const next = await send({ type: "patch-settings", patch: part });
    setSettings(next);
    applyTheme(next.theme);
    setStatus(t("options.saved"));
    setTimeout(() => setStatus(null), 1500);
  };

  if (!settings) {
    return <div className="tn-page">{t("app.loading")}</div>;
  }

  const openPage = (page: string): void => {
    void chrome.tabs.create({ url: chrome.runtime.getURL(page) });
  };

  return (
    <div className="tn-page">
      <header className="tn-page-head">
        <img src="/icons/icon32.png" alt="" width={22} height={22} />
        <div>
          <h1>{t("options.title")}</h1>
          <p className="tn-hint">{t("options.subtitle")}</p>
        </div>
        {status ? <span className="tn-status">{status}</span> : null}
      </header>

      <section className="tn-section">
        <h2>{t("options.behaviour")}</h2>
        <Select
          label={t("options.pinned")}
          value={settings.pinned}
          onChange={(value) => void patch({ pinned: value as Settings["pinned"] })}
          options={[
            { value: "ignore", labelKey: "options.pinned.ignore" },
            { value: "park", labelKey: "options.pinned.park" },
            { value: "stop", labelKey: "options.pinned.stop" },
          ]}
        />
        <Select
          label={t("options.duplicates")}
          value={settings.alreadyParked}
          onChange={(value) => void patch({ alreadyParked: value as Settings["alreadyParked"] })}
          options={[
            { value: "skip", labelKey: "options.duplicates.skip" },
            { value: "duplicate", labelKey: "options.duplicates.duplicate" },
          ]}
        />
        <Select
          label={t("options.tabGroups")}
          value={settings.tabGroups}
          onChange={(value) => void patch({ tabGroups: value as Settings["tabGroups"] })}
          options={[
            { value: "respect", labelKey: "options.tabGroups.respect" },
            { value: "flatten", labelKey: "options.tabGroups.flatten" },
          ]}
        />
        <Select
          label={t("options.closeAfter")}
          value={settings.closeAfter}
          onChange={(value) => void patch({ closeAfter: value as Settings["closeAfter"] })}
          options={[
            { value: "window", labelKey: "options.closeAfter.window" },
            { value: "tabGroup", labelKey: "options.closeAfter.tabGroup" },
            { value: "never", labelKey: "options.closeAfter.never" },
          ]}
        />
        <Select
          label={t("options.openIn")}
          value={settings.openIn}
          onChange={(value) => void patch({ openIn: value as Settings["openIn"] })}
          options={[
            { value: "current", labelKey: "options.openIn.current" },
            { value: "tab", labelKey: "options.openIn.tab" },
            { value: "window", labelKey: "options.openIn.window" },
          ]}
        />
      </section>

      <section className="tn-section">
        <h2>{t("options.capture")}</h2>
        <label className="tn-setting tn-setting--stack">
          <span className="tn-setting-label">{t("options.excluded")}</span>
          <textarea
            rows={5}
            spellCheck={false}
            value={excluded}
            onChange={(event) => setExcluded(event.currentTarget.value)}
            onBlur={(event) => {
              // Read from the control: a paste immediately followed by blur
              // arrives before React has committed the state update.
              const domains = event.currentTarget.value
                .split("\n")
                .map((line) => line.trim())
                .filter(Boolean);
              void patch({ excludedDomains: domains });
            }}
          />
          <span className="tn-hint">{t("options.excludedHint")}</span>
        </label>
      </section>

      <section className="tn-section">
        <h2>{t("options.appearance")}</h2>
        <Select
          label={t("options.theme")}
          value={settings.theme}
          onChange={(value) => void patch({ theme: value as Settings["theme"] })}
          options={[
            { value: "auto", labelKey: "options.theme.auto" },
            { value: "light", labelKey: "options.theme.light" },
            { value: "dark", labelKey: "options.theme.dark" },
          ]}
        />
      </section>

      <section className="tn-section">
        <h2>{t("options.data")}</h2>
        <p className="tn-hint">{t("options.dataHint")}</p>
        <div className="tn-button-row">
          <button type="button" className="tn-btn" onClick={() => openPage("pages/import.html")}>
            {t("options.importExport")}
          </button>
          <button
            type="button"
            className="tn-btn"
            onClick={() => {
              void send({ type: "repair" })
                .then(() => setStatus(t("options.repaired")))
                .catch((error: unknown) =>
                  setStatus(error instanceof Error ? error.message : String(error)),
                );
            }}
          >
            {t("options.repair")}
          </button>
          <button type="button" className="tn-btn" onClick={() => openPage("pages/sync.html")}>
            {t("sync.title")}
          </button>
        </div>
      </section>

      <section className="tn-section">
        <h2>{t("options.permissions")}</h2>
        <p className="tn-hint">{t("options.permissionsHint")}</p>
        <div className="tn-button-row">
          {OPTIONAL_PERMISSIONS.map((permission) => (
            <button
              key={permission.id}
              type="button"
              className="tn-btn"
              disabled={granted[permission.id] === true}
              onClick={() => {
                void chrome.permissions
                  .request({ permissions: [permission.id] })
                  .then((ok) => setGranted((previous) => ({ ...previous, [permission.id]: ok })));
              }}
            >
              {granted[permission.id]
                ? `${t(permission.labelKey)} · ${t("options.granted")}`
                : t(permission.labelKey)}
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

mount(<OptionsApp />);
