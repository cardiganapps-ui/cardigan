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
