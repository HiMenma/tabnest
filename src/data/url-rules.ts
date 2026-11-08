/**
 * Data tables used by URL canonicalisation. Kept declarative so the rules can be
 * reviewed and tested without reading logic.
 */

/** Parameters that never select content. Dropped everywhere. */
export const TRACKING_PARAMS: readonly string[] = [
  "gclid",
  "gclsrc",
  "dclid",
  "fbclid",
  "msclkid",
  "twclid",
  "igshid",
  "mc_cid",
  "mc_eid",
  "yclid",
  "_hsenc",
  "_hsmi",
  "vero_conv",
  "vero_id",
  "oly_anon_id",
  "oly_enc_id",
  "ref_src",
  "ref_url",
  "spm",
  "scm",
  "trk",
  "trkCampaign",
  "wt_mc",
  "pk_campaign",
  "pk_kwd",
  "mtm_campaign",
  "mtm_source",
  "mtm_medium",
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "utm_id",
  "utm_name",
  "utm_reader",
  "utm_referrer",
  "utm_social",
  "utm_social-type",
  "utm_brand",
  "utm_creative_format",
  "utm_marketing_tactic",
  "_gl",
  "_ga",
  "_gac",
];

/** Parameter prefixes that mark tracking on a session basis. */
export const TRACKING_PREFIXES: readonly string[] = ["utm_", "at_", "hsa_", "piwik_", "matomo_"];

export interface SearchEngine {
  /** Matched against the lowercased hostname. */
  host: string | RegExp;
  /** Matched against the pathname prefix. */
  path: string;
  /** Only these parameters are kept; all others are dropped. */
  keep: readonly string[];
}

/**
 * Search result pages carry session noise in the query string. Keeping only the
 * query-selector parameters gives a stable identity for "the same search".
 */
export const SEARCH_ENGINES: readonly SearchEngine[] = [
  { host: /(^|\.)google\./, path: "/search", keep: ["q", "tbm", "tbs", "start", "hl"] },
  { host: /(^|\.)bing\.com$/, path: "/search", keep: ["q", "first"] },
  { host: /(^|\.)duckduckgo\.com$/, path: "/", keep: ["q", "kl", "ia"] },
  { host: /(^|\.)yandex\./, path: "/search", keep: ["text", "lr"] },
  { host: /(^|\.)baidu\.com$/, path: "/s", keep: ["wd", "rn", "pn"] },
  { host: /(^|\.)so\.com$/, path: "/s", keep: ["q"] },
  { host: "search.yahoo.com", path: "/search", keep: ["p"] },
  { host: /(^|\.)ecosia\.org$/, path: "/search", keep: ["q"] },
  { host: /(^|\.)brave\.com$/, path: "/search", keep: ["q"] },
  { host: /(^|\.)startpage\.com$/, path: "/sp/search", keep: ["query"] },
  { host: /(^|\.)kagi\.com$/, path: "/search", keep: ["q"] },
];

/** Schemes a tab may have and still be parked. */
export const PARKABLE_SCHEMES: readonly string[] = ["http:", "https:", "file:"];

/**
 * Hash fragments that identify a route rather than an anchor. A fragment with a
 * slash in it ("#/issues/42") selects content; "#section" is a scroll target.
 */
export const ROUTE_LIKE_FRAGMENT = /^#!?\//;

/** URLs longer than this are quarantined instead of stored. */
export const MAX_URL_LENGTH = 65_536;
