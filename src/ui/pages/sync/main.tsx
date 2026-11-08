import { useCallback, useEffect, useRef, useState } from "react";
import { mount } from "../../mount";
import "../../sync.css";
import type { SyncArchive, SyncStatus } from "../../../background/sync/engine";
import { send } from "../../data/client";
import { downloadFile } from "../../data/export";
import { initLocale, t } from "../../i18n";
import { applyTheme } from "../../shared/theme";

initLocale();

type FieldName = "baseUrl" | "token" | "auth" | "gistId";

interface BackendUi {
  id: string;
  labelKey: string;
  encryption: "off" | "passphrase";
  fields: FieldName[];
}

const BACKENDS: BackendUi[] = [
  { id: "chrome-sync", labelKey: "sync.backend.chromeSync", encryption: "off", fields: [] },
  {
    id: "http",
    labelKey: "sync.backend.http",
    encryption: "passphrase",
    fields: ["baseUrl", "token", "auth"],
  },
  {
    id: "webdav",
    labelKey: "sync.backend.webdav",
    encryption: "passphrase",
    fields: ["baseUrl", "token", "auth"],
  },
  {
    id: "gist",
    labelKey: "sync.backend.gist",
    encryption: "passphrase",
    fields: ["token", "gistId"],
  },
];

function formatTime(timestamp: number | undefined): string {
  if (timestamp === undefined) return t("sync.never");
  return new Date(timestamp).toLocaleString();
}

function kilobytes(bytes: number | undefined): string {
  if (bytes === undefined) return "0 KiB";
  return `${(bytes / 1024).toFixed(1)} KiB`;
}

function originPattern(raw: string): string | null {
  try {
    const url = new URL(raw);
    return `${url.protocol}//${url.host}/*`;
  } catch {
    return null;
  }
}

/**
 * Asks for host access, but never blocks the caller: a prompt that cannot be
 * shown (or that the user ignores) resolves to false after a few seconds. The
 * request still works against servers that send CORS headers.
 */
async function ensureHostPermission(raw: string): Promise<boolean> {
  const pattern = originPattern(raw);
  if (!pattern) return false;
  try {
    if (await chrome.permissions.contains({ origins: [pattern] })) return true;
    return await Promise.race([
      chrome.permissions.request({ origins: [pattern] }),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 6000)),
    ]);
  } catch {
    return false;
  }
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
  const [baseUrl, setBaseUrl] = useState("");
  const [token, setToken] = useState("");
  const [auth, setAuth] = useState<"bearer" | "basic">("bearer");
  const [gistId, setGistId] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [storeId, setStoreId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const importRef = useRef<HTMLInputElement | null>(null);

  const refresh = useCallback(async () => {
    try {
      const next = await send({ type: "sync-get" });
      setStatus(next);
      if (next.storeId) setStoreId((current) => current || (next.storeId ?? ""));
      if (next.backendId) setBackendId(next.backendId);
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

  const run = async (action: () => Promise<void>): Promise<void> => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : String(problem));
    } finally {
      setBusy(false);
    }
  };

  const backend = BACKENDS.find((entry) => entry.id === backendId) ?? (BACKENDS[0] as BackendUi);
  const configured =
    status !== null && status.phase !== "unconfigured" && status.phase !== "disabled";
  const usage = status?.usage;
  const ratio = usage?.quota ? Math.min(1, usage.used / usage.quota) : 0;

  const connect = (): Promise<void> =>
    run(async () => {
      if (backend.fields.includes("baseUrl")) {
        // Best effort: a granted origin also works for servers without CORS, but
        // a refusal is not fatal because the endpoint may allow CORS itself.
        await ensureHostPermission(baseUrl);
      }
      const options = {
        ...(baseUrl.trim() ? { baseUrl: baseUrl.trim() } : {}),
        ...(token.trim() ? { token: token.trim() } : {}),
        ...(backend.fields.includes("auth") ? { auth } : {}),
        ...(gistId.trim() ? { gistId: gistId.trim() } : {}),
      };
      const next = await send({
        type: "sync-configure",
        backendId: backend.id,
        options,
        ...(passphrase ? { passphrase } : {}),
        ...(storeId.trim() ? { storeId: storeId.trim() } : {}),
      });
      setStatus(next);
    });

  const exportBackup = (): Promise<void> =>
    run(async () => {
      const archive = await send({ type: "sync-export" });
      const entries = Object.keys(archive.entries).length;
      downloadFile(
        `tabnest-sync-${new Date().toISOString().slice(0, 10)}.json`,
        JSON.stringify(archive, null, 2),
        "application/json",
      );
      setNotice(t("sync.backupDone", { count: entries }));
    });

  const importBackup = (file: File | undefined): Promise<void> =>
    run(async () => {
      if (!file) return;
      const archive = JSON.parse(await file.text()) as SyncArchive;
      const result = await send({ type: "sync-import", archive });
      setNotice(t("sync.restoreDone", { count: result.imported }));
      await refresh();
    });

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

      {error ? <p className="tn-sync-error">{error}</p> : null}
      {notice ? <p className="tn-sync-notice">{notice}</p> : null}
      {!error && status?.message ? <p className="tn-sync-error">{status.message}</p> : null}

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
            <select
              name="backend"
              value={backendId}
              onChange={(event) => setBackendId(event.currentTarget.value)}
            >
              {BACKENDS.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {t(entry.labelKey)}
                </option>
              ))}
            </select>
            {backend.id === "chrome-sync" ? (
              <span className="tn-hint">{t("sync.limitWarning")}</span>
            ) : null}
          </span>
        </label>

        {backend.fields.includes("baseUrl") ? (
          <label className="tn-setting">
            <span className="tn-setting-label">{t("sync.field.baseUrl")}</span>
            <span className="tn-setting-control">
              <input
                type="url"
                name="baseUrl"
                value={baseUrl}
                spellCheck={false}
                placeholder="https://example.com/tabnest/"
                onChange={(event) => setBaseUrl(event.currentTarget.value)}
              />
              <span className="tn-hint">{t(`sync.field.baseUrl.${backend.id}`)}</span>
            </span>
          </label>
        ) : null}

        {backend.fields.includes("token") ? (
          <label className="tn-setting">
            <span className="tn-setting-label">{t("sync.field.token")}</span>
            <span className="tn-setting-control">
              <input
                type="password"
                name="token"
                value={token}
                onChange={(event) => setToken(event.currentTarget.value)}
              />
              <span className="tn-hint">{t("sync.field.token.hint")}</span>
            </span>
          </label>
        ) : null}

        {backend.fields.includes("auth") ? (
          <label className="tn-setting">
            <span className="tn-setting-label">{t("sync.field.auth")}</span>
            <span className="tn-setting-control">
              <select
                name="auth"
                value={auth}
                onChange={(event) => setAuth(event.currentTarget.value as "bearer" | "basic")}
              >
                <option value="bearer">{t("sync.auth.bearer")}</option>
                <option value="basic">{t("sync.auth.basic")}</option>
              </select>
            </span>
          </label>
        ) : null}

        {backend.fields.includes("gistId") ? (
          <label className="tn-setting">
            <span className="tn-setting-label">{t("sync.field.gistId")}</span>
            <span className="tn-setting-control">
              <input
                type="text"
                name="gistId"
                value={gistId}
                spellCheck={false}
                onChange={(event) => setGistId(event.currentTarget.value)}
              />
              <span className="tn-hint">{t("sync.field.gistId.hint")}</span>
            </span>
          </label>
        ) : null}

        <div className="tn-setting">
          <span className="tn-setting-label">{t("sync.encryption")}</span>
          <span className="tn-setting-control">
            <span>{t(`sync.encryption.${backend.encryption}`)}</span>
            <span className="tn-hint">{t(`sync.encryptionHint.${backend.encryption}`)}</span>
          </span>
        </div>

        {backend.encryption === "passphrase" ? (
          <label className="tn-setting">
            <span className="tn-setting-label">{t("sync.passphrase")}</span>
            <span className="tn-setting-control">
              <input
                type="password"
                name="passphrase"
                value={passphrase}
                autoComplete="new-password"
                onChange={(event) => setPassphrase(event.currentTarget.value)}
              />
              <span className="tn-hint">{t("sync.passphraseHint")}</span>
            </span>
          </label>
        ) : null}

        <label className="tn-setting">
          <span className="tn-setting-label">{t("sync.storeId")}</span>
          <span className="tn-setting-control">
            <input
              type="text"
              value={storeId}
              spellCheck={false}
              readOnly={configured}
              placeholder="leave empty to create a new store"
              onChange={(event) => setStoreId(event.currentTarget.value)}
            />
            <span className="tn-hint">Paste an existing store id to join it from this device.</span>
          </span>
        </label>

        <div className="tn-button-row">
          {configured ? (
            <>
              <button
                type="button"
                className="tn-btn tn-btn--primary"
                disabled={busy}
                onClick={() => void run(async () => setStatus(await send({ type: "sync-now" })))}
              >
                {t("sync.now")}
              </button>
              <button
                type="button"
                className="tn-btn tn-btn--danger"
                disabled={busy}
                onClick={() =>
                  void run(async () => setStatus(await send({ type: "sync-disable" })))
                }
              >
                {t("sync.disconnect")}
              </button>
            </>
          ) : (
            <button
              type="button"
              className="tn-btn tn-btn--primary"
              disabled={busy}
              onClick={() => void connect()}
            >
              {t("sync.connect")}
            </button>
          )}
        </div>
      </section>

      {configured ? (
        <section className="tn-section">
          <h2>{t("sync.backup")}</h2>
          <p className="tn-hint">{t("sync.backupHint")}</p>
          <div className="tn-button-row">
            <button
              type="button"
              className="tn-btn"
              disabled={busy}
              onClick={() => void exportBackup()}
            >
              {t("sync.exportArchive")}
            </button>
            <button
              type="button"
              className="tn-btn"
              disabled={busy}
              onClick={() => importRef.current?.click()}
            >
              {t("sync.importArchive")}
            </button>
            <input
              ref={importRef}
              type="file"
              accept="application/json,.json"
              style={{ display: "none" }}
              onChange={(event) => void importBackup(event.currentTarget.files?.[0])}
            />
          </div>
        </section>
      ) : null}

      <section className="tn-section">
        <h2>{t("sync.howItWorks")}</h2>
        <p className="tn-hint">{t("sync.howItWorksBody")}</p>
      </section>
    </div>
  );
}

mount(<SyncApp />);
