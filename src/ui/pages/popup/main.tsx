import { useCallback, useEffect, useMemo, useState } from "react";
import { mount } from "../../mount";
import "../../popup.css";
import type { ParkScope } from "../../../background/capture";
import type { Settings } from "../../../data/model";
import { hostOf, isExcludedHost, isParkable } from "../../../data/url";
import { send } from "../../data/client";
import { initLocale, t, tCount } from "../../i18n";
import { Favicon } from "../../shared/Favicon";

initLocale();

function useSettings(): Settings | null {
  const [settings, setSettings] = useState<Settings | null>(null);
  useEffect(() => {
    send({ type: "settings" })
      .then(setSettings)
      .catch(() => setSettings(null));
  }, []);
  return settings;
}

function PopupApp() {
  const [tabs, setTabs] = useState<chrome.tabs.Tab[]>([]);
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const settings = useSettings();

  const load = useCallback(async (): Promise<void> => {
    const all = await chrome.tabs.query({ currentWindow: true });
    const parkable = all
      .filter((tab) => typeof tab.url === "string" && isParkable(tab.url))
      .sort((a, b) => a.index - b.index);
    setTabs(parkable);
    setChecked(
      new Set(parkable.map((tab) => tab.id).filter((id): id is number => id !== undefined)),
    );
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const visible = useMemo(() => {
    if (!settings) return tabs;
    return tabs.filter((tab) => !isExcludedHost(hostOf(tab.url ?? ""), settings.excludedDomains));
  }, [tabs, settings]);

  const activeTab = useMemo(() => tabs.find((tab) => tab.active), [tabs]);
  const activeGroupId = activeTab?.groupId ?? -1;
  const groupedCount =
    activeGroupId === -1 ? 0 : tabs.filter((tab) => tab.groupId === activeGroupId).length;

  const selectedIds = useMemo(
    () => [...checked].filter((id) => visible.some((tab) => tab.id === id)),
    [checked, visible],
  );

  const runPark = async (scope: ParkScope): Promise<void> => {
    setBusy(true);
    setMessage(null);
    try {
      const reply = await send({ type: "park", scope });
      setMessage(t("popup.parked", { count: reply.added }));
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const toggle = (id: number): void => {
    setChecked((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="tn-popup">
      <header className="tn-popup-head">
        <img src="/icons/icon32.png" alt="" width={18} height={18} />
        <strong>{t("app.name")}</strong>
        <span className="tn-popup-count">
          {tCount("popup.windowCount", "popup.windowCount", visible.length)}
        </span>
      </header>

      <ul className="tn-popup-list">
        {visible.length === 0 ? (
          <li className="tn-popup-empty">{t("popup.nothingToPark")}</li>
        ) : null}
        {visible.map((tab) => {
          const id = tab.id;
          if (id === undefined) return null;
          return (
            <li key={id} className="tn-popup-row">
              <input
                type="checkbox"
                className="tn-check"
                checked={checked.has(id)}
                onChange={() => toggle(id)}
                aria-label={tab.title ?? ""}
              />
              <Favicon url={tab.url ?? ""} />
              <span className="tn-popup-title" title={tab.title ?? ""}>
                {tab.title || hostOf(tab.url ?? "")}
              </span>
              {tab.pinned ? <span className="tn-popup-flag">📌</span> : null}
            </li>
          );
        })}
      </ul>

      {message ? <p className="tn-popup-message">{message}</p> : null}

      <div className="tn-popup-actions">
        <button
          type="button"
          className="tn-btn tn-btn--primary"
          disabled={busy || selectedIds.length === 0}
          onClick={() => void runPark({ kind: "tabs", tabIds: selectedIds })}
        >
          {tCount("popup.parkSelected", "popup.parkSelectedOne", selectedIds.length)}
        </button>
        {groupedCount > 0 ? (
          <button
            type="button"
            className="tn-btn"
            disabled={busy}
            onClick={() => void runPark({ kind: "tab-group" })}
          >
            {t("toolbar.parkGroup")} ({groupedCount})
          </button>
        ) : null}
        <button
          type="button"
          className="tn-btn"
          onClick={() => {
            void chrome.tabs.create({ url: chrome.runtime.getURL("pages/library.html") });
            window.close();
          }}
        >
          {t("popup.openLibrary")}
        </button>
      </div>
    </div>
  );
}

mount(<PopupApp />);
