import { DICTS, type Dict, en } from "./dict";

let dict: Dict = en;
let locale = "en";

export function detectLocale(): string {
  const raw =
    (typeof chrome !== "undefined" ? chrome.i18n?.getUILanguage?.() : undefined) ??
    (typeof navigator !== "undefined" ? navigator.language : undefined) ??
    "en";
  return raw.toLowerCase().startsWith("zh") ? "zh-CN" : "en";
}

export function setLocale(next: string): void {
  locale = next;
  dict = DICTS[next] ?? en;
}

export function initLocale(): string {
  setLocale(detectLocale());
  return locale;
}

export function currentLocale(): string {
  return locale;
}

/** Interpolates {{name}} placeholders. Unknown keys fall back to English, then to the key. */
export function t(key: string, vars?: Record<string, string | number>): string {
  const template = dict[key] ?? en[key] ?? key;
  if (!vars) return template;
  return template.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(vars[name] ?? ""));
}

/** Picks the singular key when count is exactly one. */
export function tCount(key: string, oneKey: string, count: number): string {
  return count === 1 ? t(oneKey, { count }) : t(key, { count });
}
