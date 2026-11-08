import { mount } from "../../mount";
import { WorkerStatus } from "../../shared/WorkerStatus";

const NAV = [
  { id: "quickList", label: "Quick list", hint: "Pinned for later" },
  { id: "root", label: "All lists", hint: "Folders and windows" },
  { id: "archive", label: "Archive", hint: "Closed without deleting" },
  { id: "trash", label: "Trash", hint: "Recoverable for 90 days" },
];

function LibraryApp() {
  return (
    <div className="tn-split">
      <nav className="tn-nav">
        <div className="tn-brand" style={{ padding: "4px 8px 12px" }}>
          <img src="/icons/icon32.png" alt="" />
          TabNest
        </div>
        {NAV.map((item, index) => (
          <div
            key={item.id}
            className={`tn-nav-item${index === 1 ? " tn-nav-item--active" : ""}`}
            title={item.hint}
          >
            {item.label}
          </div>
        ))}
      </nav>

      <section className="tn-content">
        <header className="tn-row" style={{ marginBottom: "var(--tn-4)" }}>
          <h1 className="tn-h1" style={{ margin: 0 }}>
            All lists
          </h1>
          <span className="tn-spacer" />
          <WorkerStatus />
        </header>

        <div className="tn-card">
          <h2 className="tn-h2">Scaffold is live</h2>
          <p className="tn-muted tn-small" style={{ marginTop: 0 }}>
            The build pipeline, manifest, icon generation and the page ↔ worker channel all work.
            Data layer, capture and the tree UI arrive in the next milestones.
          </p>
          <div className="tn-stack">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="tn-skel" style={{ opacity: 1 - i * 0.18 }} />
            ))}
          </div>
        </div>

        <div className="tn-card">
          <h2 className="tn-h2">Next</h2>
          <ul className="tn-list tn-small tn-muted">
            <li>M1 — IndexedDB model, URL canonicalisation, the eight parking actions</li>
            <li>M2 — tree, virtual list, search, drag and drop, inline editing</li>
            <li>M3 — import/export, options, keyboard commands, omnibox, i18n</li>
            <li>M4 — sync engine and the chrome.storage.sync backend</li>
          </ul>
        </div>
      </section>
    </div>
  );
}

mount(<LibraryApp />);
