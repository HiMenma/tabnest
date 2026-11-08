import { useCallback, useEffect, useState } from "react";
import { mount } from "../../mount";
import "../../sync.css";
import type { SyncStatus } from "../../../background/sync/engine";
import { send } from "../../data/client";
import { initLocale, t } from "../../i18n";
import { applyTheme } from "../../shared/theme";

initLocale();

function formatTime(timestamp: number | undefined): string {
  if (timestamp === undefined) return t("sync.never");
  return new Date(timestamp).toLocaleString();
}

function kilobytes(bytes: number | undefined): string {
  if (bytes === undefined) return "0 KiB";
  return `${(bytes / 1024).toFixed(1)} KiB`;
}

function PhasePill({ phase }: { phase: SyncStatus["phase"] }) {
  const tone =
    phase === "idle"
      ? "ok"
      : phase === "syncing"
        ? "warn"
        : phase === "paused" || phase === "needs-attention"
          ? "err"
          : "";
  return (
    <span className={`tn-pill${tone ? ` tn-pill--${tone}` : ""}`}>{t(`sync.phase.${phase}`)}</span>
  );
}

function SyncApp() {
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [backendId, setBackendId] = useState("chrome-sync");
  const [storeId, setStoreId] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const next = await send({ type: "sync-get" });
      setStatus(next);
      if (next.storeId) setStoreId(next.storeId);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : String(problem));
    }
  }, []);

  useEffect(() => {
    void refresh();
    void send({ type: "settings" })
      .then((settings) => applyTheme(settings.theme))
      .catch(() => undefined);

    const listener = (message: unknown): boolean => {
      if ((message as { type?: string } | null)?.type === "sync-status") {
        setStatus(message as SyncStatus);
      }
      return false;
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, [refresh]);

  const run = async (action: () => Promise<SyncStatus>): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      setStatus(await action());
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : String(problem));
    } finally {
      setBusy(false);
    }
  };

  const configured =
    status !== null && status.phase !== "unconfigured" && status.phase !== "disabled";
  const needsPassphrase = false; // chrome-sync is the only backend in M4
  const usage = status?.usage;
  const ratio = usage?.quota ? Math.min(1, usage.used / usage.quota) : 0;

  return (
    <div className="tn-page">
      <header className="tn-page-head">
        <img src="/icons/icon32.png" alt="" width={22} height={22} />
        <div>
          <h1>{t("sync.title")}</h1>
          <p className="tn-hint">{t("sync.subtitle")}</p>
        </div>
        {status ? <PhasePill phase={status.phase} /> : null}
      </header>

      {error || status?.message ? (
        <p className="tn-sync-error">{error ?? status?.message}</p>
      ) : null}

      <section className="tn-section">
        <h2>{t("sync.status")}</h2>
        <div className="tn-sync-stats">
          <span>{t("sync.queued", { count: status?.queued ?? 0 })}</span>
          <span>{t("sync.lastSync", { when: formatTime(status?.lastSyncAt) })}</span>
        </div>
        {/* Decorative: the sentence underneath carries the same information. */}
        {usage ? (
          <div className="tn-meter" aria-hidden="true">
            <div className="tn-meter-fill" style={{ width: `${Math.round(ratio * 100)}%` }} />
          </div>
        ) : null}
        {usage ? (
          <p className="tn-hint">
            {usage.quota
              ? t("sync.usage", { used: kilobytes(usage.used), quota: kilobytes(usage.quota) })
              : t("sync.usageUnknown", { used: kilobytes(usage.used) })}
          </p>
        ) : null}
      </section>

      <section className="tn-section">
        <h2>{t("sync.backend")}</h2>

        <label className="tn-setting">
          <span className="tn-setting-label">{t("sync.backend")}</span>
          <span className="tn-setting-control">
            <select value={backendId} onChange={(event) => setBackendId(event.currentTarget.value)}>
              <option value="chrome-sync">{t("sync.backend.chromeSync")}</option>
            </select>
            <span className="tn-hint">{t("sync.limitWarning")}</span>
          </span>
        </label>

        <div className="tn-setting">
          <span className="tn-setting-label">{t("sync.encryption")}</span>
          <span className="tn-setting-control">
            <span>{t("sync.encryption.off")}</span>
            <span className="tn-hint">{t("sync.encryptionHint.off")}</span>
          </span>
        </div>

        {needsPassphrase ? (
          <label className="tn-setting">
            <span className="tn-setting-label">{t("sync.passphrase")}</span>
            <span className="tn-setting-control">
              <input
                type="password"
                value={passphrase}
                onChange={(event) => setPassphrase(event.currentTarget.value)}
              />
              <span className="tn-hint">{t("sync.passphraseHint")}</span>
            </span>
          </label>
        ) : null}

        {configured ? (
          <div className="tn-setting">
            <span className="tn-setting-label">{t("sync.storeId")}</span>
            <span className="tn-setting-control">
              <code className="tn-store-id">{status?.storeId ?? storeId}</code>
              <span className="tn-hint">
                Share this id on the other device to join the same store.
              </span>
            </span>
          </div>
        ) : null}

        <div className="tn-button-row">
          {configured ? (
            <>
              <button
                type="button"
                className="tn-btn tn-btn--primary"
                disabled={busy}
                onClick={() => void run(() => send({ type: "sync-now" }))}
              >
                {t("sync.now")}
              </button>
              <button
                type="button"
                className="tn-btn tn-btn--danger"
                disabled={busy}
                onClick={() => void run(() => send({ type: "sync-disable" }))}
              >
                {t("sync.disconnect")}
              </button>
            </>
          ) : (
            <button
              type="button"
              className="tn-btn tn-btn--primary"
              disabled={busy}
              onClick={() =>
                void run(() =>
                  send({
                    type: "sync-configure",
                    backendId,
                    ...(storeId.trim() ? { storeId: storeId.trim() } : {}),
                    ...(passphrase ? { passphrase } : {}),
                  }),
                )
              }
            >
              {t("sync.connect")}
            </button>
          )}
        </div>

        {!configured ? (
          <label className="tn-setting" style={{ marginTop: "var(--tn-3)" }}>
            <span className="tn-setting-label">{t("sync.storeId")}</span>
            <span className="tn-setting-control">
              <input
                type="text"
                value={storeId}
                placeholder="leave empty to create a new store"
                onChange={(event) => setStoreId(event.currentTarget.value)}
              />
              <span className="tn-hint">
                Paste an existing store id to join it from this device.
              </span>
            </span>
          </label>
        ) : null}
      </section>

      <section className="tn-section">
        <h2>{t("sync.howItWorks")}</h2>
        <p className="tn-hint">{t("sync.howItWorksBody")}</p>
      </section>
    </div>
  );
}

mount(<SyncApp />);
