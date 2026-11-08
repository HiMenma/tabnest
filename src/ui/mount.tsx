import { type ReactNode, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./tokens.css";
import "./base.css";

/** Mounts a page's root component into #root. */
export function mount(node: ReactNode): void {
  const el = document.getElementById("root");
  if (!el) throw new Error("TabNest: #root element is missing");
  createRoot(el).render(<StrictMode>{node}</StrictMode>);
}
