import { useEffect, useState } from "react";
import type { PingResponse } from "../../types/messages";

type State =
  | { kind: "pending" }
  | { kind: "ok"; version: string; ms: number }
  | { kind: "error"; message: string };

/**
 * Shows whether the service worker answers. Proves the page <-> worker bus is
 * alive; the same channel carries sync status later.
 */
export function WorkerStatus() {
  const [state, setState] = useState<State>({ kind: "pending" });

  useEffect(() => {
    let cancelled = false;
    const started = performance.now();

    chrome.runtime
      .sendMessage({ type: "ping" } satisfies { type: "ping" })
      .then((reply: unknown) => {
        if (cancelled) return;
        const res = reply as PingResponse | null;
        if (res === null) throw new Error("no reply from worker");
        if (res.ok !== true) throw new Error("unexpected reply from worker");
        setState({ kind: "ok", version: res.version, ms: Math.round(performance.now() - started) });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setState({ kind: "error", message: err instanceof Error ? err.message : String(err) });
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (state.kind === "pending") return <span className="tn-pill">worker…</span>;
  if (state.kind === "error") {
    return (
      <span className="tn-pill tn-pill--err" title={state.message}>
        worker unreachable
      </span>
    );
  }
  return (
    <span className="tn-pill tn-pill--ok" title={`round trip ${state.ms} ms`}>
      worker v{state.version}
    </span>
  );
}
