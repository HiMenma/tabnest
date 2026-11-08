/**
 * URL identity.
 *
 * The canonical form is what the library stores for comparison purposes, and the
 * id of a parked tab is derived from it. That makes dedupe and cross-device
 * convergence fall out of the address itself, with no negotiation.
 */
import {
  MAX_URL_LENGTH,
  PARKABLE_SCHEMES,
  ROUTE_LIKE_FRAGMENT,
  SEARCH_ENGINES,
  TRACKING_PARAMS,
  TRACKING_PREFIXES,
} from "./url-rules";

const TRACKING = new Set(TRACKING_PARAMS);

export function isParkable(raw: string): boolean {
  if (!raw) return false;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (!PARKABLE_SCHEMES.includes(url.protocol)) return false;
  if (url.protocol === "file:" && !url.pathname) return false;
  return true;
}

export function isTooLong(raw: string): boolean {
  return raw.length > MAX_URL_LENGTH;
}

function isTracking(name: string): boolean {
  if (TRACKING.has(name)) return true;
  return TRACKING_PREFIXES.some((prefix) => name.startsWith(prefix));
}

function matchesHost(rule: string | RegExp, host: string): boolean {
  if (rule instanceof RegExp) return rule.test(host);
  return rule === host;
}

function searchKeepList(host: string, pathname: string): readonly string[] | null {
  for (const engine of SEARCH_ENGINES) {
    if (matchesHost(engine.host, host) && pathname.startsWith(engine.path)) return engine.keep;
  }
  return null;
}

/**
 * Returns the canonical identity of a URL, or null when the URL cannot be
 * parked (unsupported scheme, unparseable, absurd length).
 */
export function canonicalizeUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > MAX_URL_LENGTH) return null;

  // data: URLs have no host or path; keep only the media type prefix so two
  // images do not collapse into one record.
  if (/^data:/i.test(trimmed)) {
    const match = /^data:([^;,]*)/i.exec(trimmed);
    return `data:${(match?.[1] ?? "").toLowerCase()}`;
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (!PARKABLE_SCHEMES.includes(url.protocol)) return null;

  const host = url.hostname.toLowerCase();
  const pathname = url.pathname || "/";

  // Fragments are kept only when they select a route rather than scroll to an anchor.
  const fragment = ROUTE_LIKE_FRAGMENT.test(url.hash) ? url.hash : "";

  const keep = searchKeepList(host, pathname);
  const params = new URLSearchParams(url.search);
  const kept: string[] = [];
  for (const [name, value] of params) {
    if (keep !== null) {
      if (keep.includes(name)) kept.push(`${name}=${value}`);
      continue;
    }
    if (isTracking(name)) continue;
    kept.push(`${name}=${value}`);
  }

  const query = kept.length > 0 ? `?${kept.join("&")}` : "";
  const authority = url.port ? `${host}:${url.port}` : host;
  return `${url.protocol}//${authority}${pathname}${query}${fragment}`;
}

const ID_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_";

/** base64url-ish encoding of the first 132 bits of SHA-256. 22 characters. */
export function hashToId(bytes: Uint8Array): string {
  let bits = "";
  for (const byte of bytes) bits += byte.toString(2).padStart(8, "0");
  const truncated = bits.slice(0, 132);
  let out = "";
  for (let i = 0; i < 22; i++) {
    out += ID_ALPHABET[Number.parseInt(truncated.slice(i * 6, (i + 1) * 6), 2)] ?? "0";
  }
  return out;
}

/** The id a tab record gets for a canonical URL. */
export async function urlId(canonicalUrl: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalUrl));
  return hashToId(new Uint8Array(digest));
}

/** Hostname for display and grouping; empty for anything that is not a web page. */
export function hostOf(url: string): string {
  try {
    const parsed = new URL(url);
    if (!PARKABLE_SCHEMES.includes(parsed.protocol)) return "";
    return parsed.hostname.toLowerCase();
  } catch {
    return "";
  }
}

/** A readable fallback title when the page had none. */
export function fallbackTitle(url: string): string {
  try {
    const parsed = new URL(url);
    const path = decodeURIComponent(parsed.pathname).replace(/\/$/, "");
    const last = path.split("/").filter(Boolean).pop();
    if (last) return `${parsed.hostname} — ${last}`.slice(0, 200);
    return parsed.hostname || url;
  } catch {
    return url.slice(0, 200);
  }
}

export function normalizeTitle(title: string | undefined, url: string): string {
  const cleaned = (title ?? "").replace(/\s+/g, " ").trim();
  if (!cleaned) return fallbackTitle(url);
  return cleaned.slice(0, 500);
}

/** True when the host matches an entry of the user's exclusion list. */
export function hostMatchesPattern(host: string, pattern: string): boolean {
  const normalized = pattern.trim().toLowerCase().replace(/^\*\./, "");
  if (!normalized) return false;
  return host === normalized || host.endsWith(`.${normalized}`);
}

export function isExcludedHost(host: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => hostMatchesPattern(host, pattern));
}
