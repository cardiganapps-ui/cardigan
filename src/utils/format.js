/* ── Number / currency formatting ──────────────────────────────────
   One module, MXN-locale-pinned, tabular-friendly. Replaces a long
   tail of inline `.toLocaleString()` calls (some with locale, some
   without) so digits read consistently across the app and users
   on different system locales never see a stray period-instead-of-
   comma decimal separator.

   - formatMXN(n)         — "$1,234" (no decimals; almost every
                            in-app surface should use this).
   - formatMXNDecimal(n)  — "$1,234.50" (exactly 2 decimals; receipts
                            and invoice rows where cents matter).
   - formatMXNCents(c)    — "$299" from 29900 (Stripe-style cents in
                            → display amount out).
   - formatNumber(n)      — "1,234" (non-currency counts, no $).
   - formatPercent(n)     — "23%" (rounded; for KPIs).

   All helpers are null/undefined/NaN-safe and pin "es-MX" so the
   thousands separator is always a comma and decimals always a
   period (LATAM convention). Pair with the .tabular-nums CSS
   utility (see base.css) to lock digit widths in dashboard tiles
   so columns of numbers don't visually shimmer when amounts
   differ by digit count. */

const NF_INT = new Intl.NumberFormat("es-MX", {
  maximumFractionDigits: 0,
});

const NF_DECIMAL = new Intl.NumberFormat("es-MX", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const NF_PERCENT = new Intl.NumberFormat("es-MX", {
  style: "percent",
  maximumFractionDigits: 0,
});

function safeNumber(n) {
  if (typeof n === "number" && Number.isFinite(n)) return n;
  if (typeof n === "string" && n.trim() !== "") {
    const parsed = Number(n);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

export function formatMXN(n) {
  return `$${NF_INT.format(safeNumber(n))}`;
}

export function formatMXNDecimal(n) {
  return `$${NF_DECIMAL.format(safeNumber(n))}`;
}

export function formatMXNCents(cents) {
  return formatMXN(safeNumber(cents) / 100);
}

export function formatNumber(n) {
  return NF_INT.format(safeNumber(n));
}

export function formatPercent(n) {
  // Caller passes a decimal (0.23) OR a percentage (23). Heuristic:
  // anything between -1 and 1 is treated as a fraction; everything
  // else as a percentage value. Most dashboards in Cardigan pass
  // already-multiplied values (e.g. 23 for 23%).
  const v = safeNumber(n);
  if (Math.abs(v) <= 1) return NF_PERCENT.format(v);
  return `${NF_INT.format(v)}%`;
}

/* ── Date formatting ──
   Single helper for user-facing dates so the whole app speaks one
   format-vocabulary in es-MX. Variants:

     "short"    "30 may"                    list rows, badges
     "shortDay" "30 may, lun"               list rows that need DOW
     "shortYear" "30 may 2026"              when year matters (history)
     "long"     "30 de mayo de 2026"        hero / summary
     "longTime" "30 de mayo de 2026, 22:16" notes / receipts

   Accepts a Date, an ISO string, or anything `new Date(x)` parses.
   Returns "" on null/invalid input rather than "Invalid Date" — caller
   gates the empty-string with conditional rendering.

   Storage-format helpers ("D-MMM" — see utils/dates.js::formatShortDate)
   are SEPARATE on purpose: those are persisted in the DB and aren't
   subject to the locale/format pass. This helper only owns display. */
const DATE_OPTS = {
  short:      { day: "numeric", month: "short" },
  shortDay:   { day: "numeric", month: "short", weekday: "short" },
  shortYear:  { day: "numeric", month: "short", year: "numeric" },
  long:       { day: "numeric", month: "long", year: "numeric" },
  longTime:   { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" },
};

export function formatDate(input, variant = "long") {
  if (input == null || input === "") return "";
  const d = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(d.getTime())) return "";
  const opts = DATE_OPTS[variant] || DATE_OPTS.long;
  // Strip the trailing period es-MX appends to short month names
  // ("30 may." → "30 may"). Keeps display tight; the period adds no
  // information and clashes with how amounts/badges sit beside dates.
  return d.toLocaleDateString("es-MX", opts).replace(/\.(?=,|$|\s)/g, "");
}
