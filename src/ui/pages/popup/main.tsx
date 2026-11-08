import { mount } from "../../mount";
import { WorkerStatus } from "../../shared/WorkerStatus";

function PopupApp() {
  const openLibrary = () => {
    void chrome.tabs.create({ url: chrome.runtime.getURL("pages/library.html") });
  };

  return (
    <div style={{ padding: "var(--tn-3)" }}>
      <header className="tn-row" style={{ marginBottom: "var(--tn-3)" }}>
        <div className="tn-brand">
          <img src="/icons/icon32.png" alt="" />
          TabNest
        </div>
        <span className="tn-spacer" />
        <WorkerStatus />
      </header>

      <div className="tn-card" style={{ padding: "var(--tn-3)" }}>
        <p className="tn-muted tn-small" style={{ margin: 0 }}>
          Parking actions land in M2. This popup currently only proves the channel.
        </p>
      </div>

      <button
        type="button"
        onClick={openLibrary}
        style={{
          marginTop: "var(--tn-3)",
          width: "100%",
          padding: "6px 10px",
          borderRadius: "var(--tn-r-sm)",
          border: "1px solid var(--tn-border-strong)",
          background: "var(--tn-bg-raised)",
          cursor: "pointer",
        }}
      >
        Open library
      </button>
    </div>
  );
}

mount(<PopupApp />);
