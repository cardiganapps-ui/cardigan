/* ── Pro value-realization helper ─────────────────────────────────────
   Computes the "Cardigan Pro paid for itself" framing shown in the
   Settings → plan panel for active subscribers. Pure (no React, no
   network) so it can be unit-tested directly.

   Inputs are the live `sessions` and `payments` arrays from
   CardiganContext + a reference Date (defaults to "now"). We focus on
   the current calendar month because that's the cadence at which the
   user will be billed, which is the right anchor for the "X% of your
   month" framing. */

import { parseShortDate } from "./dates.js";

const PRICE_MONTHLY_CENTS = 29900; // $299 MXN — mirrors Stripe price

/* Returns a Date or null. We rely on existing parsing utilities (the
   stored format is "D-MMM" / "D MMM" with optional year suffix) so any
   format quirks the rest of the app handles also resolve here. */
function parseRowDate(short, refDate) {
  if (!short) return null;
  const d = parseShortDate(short, refDate);
  return d && !Number.isNaN(d.getTime()) ? d : null;
}

/* Predicate: is this session "completed-equivalent" for the value
   widget? We're estimating revenue capacity, not strict accounting —
   so we count completed, charged, and past-scheduled (the auto-
   complete equivalent the rest of the app uses). cancelled-without-
   charge is excluded. */
function sessionCompletedEquivalent(s, now) {
  if (!s || !s.status) return false;
  if (s.status === "completed") return true;
  if (s.status === "charged") return true;
  if (s.status === "scheduled") {
    const d = parseRowDate(s.date, now);
    if (!d) return false;
    // Treat any session whose date is strictly in the past as completed-
    // equivalent; we don't bother parsing time here (the widget is an
    // estimate, not a balance).
    return d.getTime() < startOfDay(now).getTime();
  }
  return false;
}

function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function startOfMonth(date) {
  const d = new Date(date);
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d;
}

/* Sum the MXN earned this calendar month from the payments table. We
   prefer payments-as-truth for the dollar figure (since recorded
   payments are what the therapist has actually collected) and use
   sessions only for the count narrative. */
function paymentsThisMonth(payments, now) {
  const monthStart = startOfMonth(now);
  let total = 0;
  for (const p of payments || []) {
    const d = parseRowDate(p.date, now);
    if (!d) continue;
    if (d.getTime() < monthStart.getTime()) continue;
    if (d.getTime() > now.getTime()) continue; // future-dated, ignore
    const amt = Number(p.amount);
    if (Number.isFinite(amt)) total += amt;
  }
  return total;
}

function sessionsThisMonth(sessions, now) {
  const monthStart = startOfMonth(now);
  let count = 0;
  for (const s of sessions || []) {
    if (!sessionCompletedEquivalent(s, now)) continue;
    const d = parseRowDate(s.date, now);
    if (!d) continue;
    if (d.getTime() < monthStart.getTime()) continue;
    count += 1;
  }
  return count;
}

/* Public API. Returns null when the eligibility threshold isn't met
   (e.g. brand-new user with no historic data) — caller hides the
   widget rather than showing a zero-state.

   Threshold: ≥10 sessions logged ever. Avoids the awkward "you logged
   0 sessions this month, Pro is Infinity% of your month" zero-state
   for inactive accounts. */
export function computeProValue(sessions, payments, now = new Date(), {
  totalSessionThreshold = 10,
  monthlyPriceCents = PRICE_MONTHLY_CENTS,
} = {}) {
  const totalSessionsLogged = (sessions || []).length;
  if (totalSessionsLogged < totalSessionThreshold) return null;

  const sessionsCount = sessionsThisMonth(sessions, now);
  const earnedMxn = paymentsThisMonth(payments, now);

  // Percentage of the user's month that Cardigan Pro represents.
  // Capped at 100 (a slow month doesn't show a >100% number; we just
  // hide the percentage in the caller when earnings are too low).
  const monthlyPriceMxn = monthlyPriceCents / 100;
  const proSharePct = earnedMxn > 0
    ? Math.min(100, Math.round((monthlyPriceMxn / earnedMxn) * 100 * 10) / 10)
    : null;

  return {
    sessionsCount,
    earnedMxn,
    proSharePct,
    monthlyPriceMxn,
  };
}
