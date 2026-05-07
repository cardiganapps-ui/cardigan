/* ── Folder link parser + display helpers ────────────────────────────
   Single source of truth for validating, normalizing, and labeling
   the external folder URLs users paste onto a patient. Pure (no
   side effects, no React, no Supabase) so the UI components and
   the unit tests share identical behavior.

   Returns a discriminated result with a `reason` code on failure so
   the UI can surface a specific error message ("Solo enlaces que
   empiezan con https://") instead of a generic "invalid". Each
   reason maps to a real-world failure mode users hit:

     empty       → null/undefined/"" or only whitespace
     too_long    → > 2048 chars (matches DB constraint; usually a
                   paste of an entire HTML snippet rather than a URL)
     bad_url     → URL constructor threw — malformed or no host
     bad_scheme  → not http: or https: (blocks javascript:, data:,
                   file:, mailto:, tel: — every scheme the browser
                   would happily honor as <a href>) */

// Provider detection: ordered, first-match-wins. Tested per host as
// a pure function so we can drop in new providers without touching
// the parser. Hosts compared lowercase and post-IDN-normalized
// (`new URL(...).host` already does both).
const PROVIDERS = [
  {
    id: "google_drive",
    label: "Google Drive",
    test: (h) => h === "drive.google.com" || h === "docs.google.com",
  },
  {
    id: "onedrive",
    label: "OneDrive",
    test: (h) =>
      h === "onedrive.live.com" ||
      h === "1drv.ms" ||
      h.endsWith(".sharepoint.com"),
  },
  {
    id: "dropbox",
    label: "Dropbox",
    test: (h) =>
      h === "dropbox.com" ||
      h === "www.dropbox.com" ||
      h === "db.tt",
  },
  {
    id: "icloud",
    label: "iCloud",
    test: (h) => h === "icloud.com" || h.endsWith(".icloud.com"),
  },
];

const MAX_URL_LEN = 2048;

function fail(reason) {
  return { provider: null, label: "", host: "", url: "", valid: false, reason };
}

/**
 * Parse a raw user input into a normalized folder link.
 * @param {unknown} rawInput
 * @returns {{ provider: string|null, label: string, host: string, url: string, valid: boolean, reason: string|null }}
 */
export function parseFolderLink(rawInput) {
  if (rawInput == null || typeof rawInput !== "string") return fail("empty");
  // Strip surrounding whitespace + matched outer quotes (paste from
  // chat apps wraps URLs in "…" or '…' or `…`). We only strip a
  // single matching pair — internal quotes inside the URL stay.
  let trimmed = rawInput.trim();
  if (!trimmed) return fail("empty");
  const first = trimmed.charAt(0);
  const last = trimmed.charAt(trimmed.length - 1);
  if (
    (first === '"' && last === '"') ||
    (first === "'" && last === "'") ||
    (first === "`" && last === "`")
  ) {
    trimmed = trimmed.slice(1, -1).trim();
    if (!trimmed) return fail("empty");
  }
  if (trimmed.length > MAX_URL_LEN) return fail("too_long");

  // Scheme handling — three branches:
  //   1. Starts with http(s):// → use as-is.
  //   2. Starts with any OTHER scheme (javascript:, data:, file:,
  //      mailto:, tel:, ftp:, etc.) → reject immediately. We must
  //      NOT auto-prepend https:// to these because the URL parser
  //      would then accept "https://javascript:alert(1)" as a valid
  //      URL with host "javascript" — the dangerous string lands in
  //      <a href> and the click executes.
  //   3. No scheme at all (e.g. "drive.google.com/…") → prepend
  //      https:// for typing convenience.
  // The scheme regex matches the RFC 3986 scheme grammar:
  //   ALPHA *( ALPHA / DIGIT / "+" / "-" / "." ) ":"
  let candidate;
  if (/^https?:\/\//i.test(trimmed)) {
    candidate = trimmed;
  } else if (/^[a-z][a-z0-9+\-.]*:/i.test(trimmed)) {
    return fail("bad_scheme");
  } else {
    candidate = `https://${trimmed}`;
  }

  let u;
  try { u = new URL(candidate); } catch { return fail("bad_url"); }

  // Some inputs parse but have no host (e.g. `https://`). Reject.
  if (!u.host) return fail("bad_url");

  // Scheme allowlist. The render path uses <a href={url}> so any
  // scheme the browser dispatches would otherwise execute.
  if (u.protocol !== "https:" && u.protocol !== "http:") return fail("bad_scheme");

  // Auto-upgrade plain http: to https:. We already trust the user
  // typed a real URL; insisting on https avoids storing a flat link
  // that might get MITM'd at the user's network.
  if (u.protocol === "http:") u.protocol = "https:";

  const host = u.host.toLowerCase();
  const match = PROVIDERS.find((p) => p.test(host));
  return {
    provider: match?.id || "generic",
    label: match?.label || host,
    host,
    url: u.toString(),
    valid: true,
    reason: null,
  };
}

/**
 * Display-only: shorten a long URL for the linked-state card so a
 * paste of a long share URL with tokens doesn't blow out the
 * layout. Strategy: keep the host + first path segment, ellipsize
 * the rest. Falls through to the input on parse failure.
 */
export function shortenForDisplay(url, max = 42) {
  if (!url || typeof url !== "string") return "";
  let u;
  try { u = new URL(url); } catch { return url.length > max ? url.slice(0, max - 1) + "…" : url; }
  // host + the first non-empty path segment is enough context
  // ("drive.google.com/folders") — the ID part is meaningless to
  // the human eye and compounds the length.
  const segments = u.pathname.split("/").filter(Boolean);
  const firstSeg = segments[0] || "";
  const rest = segments.length > 1 ? "/…" : "";
  const display = firstSeg ? `${u.host}/${firstSeg}${rest}` : u.host;
  if (display.length <= max) return display;
  return display.slice(0, max - 1) + "…";
}
