import { mount } from "../../mount";
import { WorkerStatus } from "../../shared/WorkerStatus";

const SECTIONS = [
  { title: "General", body: "Theme, opening behaviour, duplicate handling." },
  { title: "Capture rules", body: "Pinned tabs, excluded domains, tab-group mapping." },
  { title: "Import & export", body: "Plain text, bookmarks, reading list, and archive files." },
  {
    title: "Sync",
    body: "Backend selection, encryption, device list.",
    href: "/pages/sync.html",
    linkLabel: "Open sync settings",
  },
];

function OptionsApp() {
  return (
    <div className="tn-app">
      <header className="tn-header">
        <div className="tn-brand">
          <img src="/icons/icon32.png" alt="" />
          TabNest
        </div>
        <span className="tn-spacer" />
        <WorkerStatus />
      </header>

      <main className="tn-main">
        <h1 className="tn-h1">Options</h1>
        <p className="tn-muted tn-small">
          Settings are wired up in M3. The sections below are the agreed surface, listed so the
          layout can settle early.
        </p>

        {SECTIONS.map((section) => (
          <div className="tn-card" key={section.title}>
            <h2 className="tn-h2">{section.title}</h2>
            <p className="tn-muted tn-small" style={{ margin: 0 }}>
              {section.body}
            </p>
            {section.href ? (
              <p className="tn-small" style={{ marginBottom: 0 }}>
                <a href={section.href}>{section.linkLabel}</a>
              </p>
            ) : null}
          </div>
        ))}
      </main>
    </div>
  );
}

mount(<OptionsApp />);
