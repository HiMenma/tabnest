import { mount } from "../../mount";
import { WorkerStatus } from "../../shared/WorkerStatus";

// Mirrors the backend matrix in docs/sync-design.md. The engine (M4) will own
// this list; keeping it here now documents the intended surface on screen.
const BACKENDS = [
  {
    id: "chrome-sync",
    name: "Chrome storage.sync",
    config: "None — uses your Chrome profile",
    capacity: "~100 KB",
    encryption: "optional",
    status: "M4",
  },
  {
    id: "webdav",
    name: "WebDAV",
    config: "URL + credentials (Nextcloud, Synology, 坚果云)",
    capacity: "your quota",
    encryption: "on by default",
    status: "M5",
  },
  {
    id: "http",
    name: "Custom endpoint",
    config: "Base URL + token; seven routes, documented",
    capacity: "yours",
    encryption: "on by default",
    status: "M5",
  },
  {
    id: "gist",
    name: "GitHub Gist",
    config: "Fine-grained token with gist scope",
    capacity: "1 MB per file",
    encryption: "on by default",
    status: "M5",
  },
  {
    id: "file",
    name: "Local archive",
    config: "None — export and import a file",
    capacity: "unlimited",
    encryption: "on by default",
    status: "M5",
  },
];

function SyncApp() {
  return (
    <div className="tn-app">
      <header className="tn-header">
        <div className="tn-brand">
          <img src="/icons/icon32.png" alt="" />
          TabNest
          <span className="tn-faint tn-small" style={{ fontWeight: 400 }}>
            sync
          </span>
        </div>
        <span className="tn-spacer" />
        <span className="tn-pill">not configured</span>
        <WorkerStatus />
      </header>

      <main className="tn-main">
        <h1 className="tn-h1">Sync</h1>
        <p className="tn-muted tn-small">
          TabNest writes to an object store you pick. Every device only ever writes its own key
          prefix, so no locking service is needed and a plain WebDAV folder is enough.
        </p>

        <div className="tn-card">
          <h2 className="tn-h2">Backends</h2>
          <table className="tn-small" style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr className="tn-faint" style={{ textAlign: "left" }}>
                <th style={{ padding: "4px 8px 4px 0", fontWeight: 500 }}>Backend</th>
                <th style={{ padding: "4px 8px", fontWeight: 500 }}>Configuration</th>
                <th style={{ padding: "4px 8px", fontWeight: 500 }}>Capacity</th>
                <th style={{ padding: "4px 8px", fontWeight: 500 }}>Encryption</th>
                <th style={{ padding: "4px 0 4px 8px", fontWeight: 500 }}>Lands in</th>
              </tr>
            </thead>
            <tbody>
              {BACKENDS.map((backend) => (
                <tr key={backend.id} style={{ borderTop: "1px solid var(--tn-border)" }}>
                  <td style={{ padding: "6px 8px 6px 0", whiteSpace: "nowrap" }}>{backend.name}</td>
                  <td style={{ padding: "6px 8px" }} className="tn-muted">
                    {backend.config}
                  </td>
                  <td style={{ padding: "6px 8px", whiteSpace: "nowrap" }}>{backend.capacity}</td>
                  <td style={{ padding: "6px 8px", whiteSpace: "nowrap" }}>{backend.encryption}</td>
                  <td style={{ padding: "6px 0 6px 8px" }} className="tn-faint">
                    {backend.status}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="tn-card">
          <h2 className="tn-h2">Status</h2>
          <p className="tn-muted tn-small" style={{ margin: 0 }}>
            The engine, change journal and quota guard land in M4. Until then this page is a
            read-only description of the design — no controls are active.
          </p>
        </div>
      </main>
    </div>
  );
}

mount(<SyncApp />);
