/* ── Phone + email helpers ──
   Mexican phones are stored and rendered in a 2-4-4 block format:
     55 5432 0571
   This util takes any input (digits, spaces, dashes, parens) and
   reformats it. On save we strip back to digits-only so every row in
   the DB is normalized — formatting happens only at the edges.

   Click-to-call uses `tel:` with a `+52` prefix when we see a bare
   10-digit Mexican number; otherwise we pass the digits through so
   local / international numbers still work.

   Click-to-email uses plain `mailto:`. */

/** Return the digits-only representation of a phone value. */
export function phoneDigits(value) {
  return (value || "").replace(/\D+/g, "");
}

/**
 * Format a phone value as `XX XXXX XXXX`.
 * - Returns "" for empty input.
 * - For fewer than 10 digits, formats progressively so the value stays
 *   readable as the user types.
 * - Anything past 10 digits is appended after a space to avoid silently
 *   dropping user input.
 */
export function formatPhoneMX(value) {
  const d = phoneDigits(value);
  if (!d) return "";
  if (d.length <= 2) return d;
  if (d.length <= 6) return `${d.slice(0, 2)} ${d.slice(2)}`;
  if (d.length <= 10) return `${d.slice(0, 2)} ${d.slice(2, 6)} ${d.slice(6)}`;
  return `${d.slice(0, 2)} ${d.slice(2, 6)} ${d.slice(6, 10)} ${d.slice(10)}`;
}

/** Return an href for `tel:` links. Prepends +52 for bare 10-digit MX numbers. */
export function phoneHref(value) {
  const d = phoneDigits(value);
  if (!d) return null;
  // Heuristic: a 10-digit Mexican number with no country code. Add +52.
  if (d.length === 10) return `tel:+52${d}`;
  // Already includes country code (e.g. 52…) or is a longer intl number —
  // preserve a + prefix so the dialer treats it as international.
  if (d.length > 10) return `tel:+${d}`;
  // Shorter numbers (e.g. extensions, non-standard) — pass through.
  return `tel:${d}`;
}

/** mailto href, or null when the value isn't an email-ish string. */
export function emailHref(value) {
  const v = (value || "").trim();
  if (!v || !v.includes("@")) return null;
  return `mailto:${v}`;
}
