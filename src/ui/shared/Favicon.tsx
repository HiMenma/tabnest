import { useState } from "react";

/**
 * Site icon via Chrome's local favicon cache. No third-party service is asked,
 * which matters: an icon API would leak every parked URL to that service.
 */
export function Favicon({ url, size = 16 }: { url: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  const host = (() => {
    try {
      return new URL(url).hostname.replace(/^www\./, "");
    } catch {
      return "";
    }
  })();

  if (failed || !host) {
    return (
      <span
        className="tn-favicon tn-favicon--letter"
        aria-hidden="true"
        style={{ width: size, height: size }}
      >
        {(host[0] ?? "?").toUpperCase()}
      </span>
    );
  }

  const source = `${chrome.runtime.getURL("/_favicon/")}?pageUrl=${encodeURIComponent(url)}&size=${size}`;
  return (
    <img
      className="tn-favicon"
      style={{ width: size, height: size }}
      src={source}
      alt=""
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}
