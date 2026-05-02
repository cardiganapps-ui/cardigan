/* ── Subscription status messaging ────────────────────────────────────
   One place to describe a user's billing state in human-readable form.
   Used in:
     - Settings row sub-line (terse one-liner)
     - Suscripción sheet hero (explicit "what's happening to my money")

   The goal: zero ambiguity. After reading either string, a user must
   know (a) what their access is, (b) whether they're going to be
   charged, (c) when, and (d) for how much.

   Pure helpers — tested. Format dates with Intl in es-MX. */

const PRICE_MONTHLY_CENTS = 29900;
const PRICE_ANNUAL_CENTS = 299000;

// "30 de mayo" — short form for the row sub-line.
function formatShort(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("es-MX", { day: "numeric", month: "short" })
    .replace(/\.$/, ""); // "30 may." → "30 may"
}

// "30 de mayo de 2026" — full form for the explicit hero sentence.
function formatLong(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric" });
}

// "$299" — currency without decimals (we only deal in whole pesos for
// Cardigan Pro). The "MXN" suffix lives in the surrounding sentence.
function formatPriceMXN(cents) {
  if (typeof cents !== "number" || !Number.isFinite(cents) || cents <= 0) return null;
  return `$${(cents / 100).toLocaleString("es-MX", { maximumFractionDigits: 0 })}`;
}

/* Decide which "billing situation" the user is in. Returns one of:
     comp      — admin-granted free access, no charges ever
     past_due  — failed renewal, Stripe is retrying, fix payment
     cancelling — Stripe sub is winding down (cancel_at_period_end OR
                  cancel_at set). Access until end date, then no more.
     renewing  — Stripe sub is healthy and will renew on schedule.
     trial_with_sub — user is in trial AND has subscribed (card on
                  file). At trial end, Stripe charges them and rolls to
                  renewing — UNLESS they've also cancelled, which lands
                  them in cancelling instead.
     trial_no_sub — pure trial, no Stripe customer. Access until trial
                  end, then expired.
     trial_expiring_today — last day of trial.
     expired   — no access. Need to subscribe.
     loading   — still fetching the subscription state.
     unknown   — fall-through; render a safe generic label. */
export function classifyBillingState(s) {
  if (!s) return "loading";
  if (s.loading) return "loading";
  if (s.compGranted) return "comp";

  const status = s.subscription?.status;
  if (status === "past_due") return "past_due";

  // "Cancelling" = Stripe sub still has access, but it's scheduled to
  // end. Either of the two Stripe variants counts.
  const hasCancellation = !!s.subscription?.cancel_at_period_end
    || !!s.subscription?.cancel_at;
  if (s.subscribedActive && hasCancellation) return "cancelling";

  if (s.subscribedActive) {
    // trialing + dpm = paid sub still in trial. Different messaging
    // than active because the FIRST charge is in the future.
    if (status === "trialing") return "trial_with_sub";
    return "renewing";
  }

  if (s.accessState === "trial") {
    if (s.daysLeftInTrial != null && s.daysLeftInTrial <= 1) return "trial_expiring_today";
    return "trial_no_sub";
  }

  if (s.accessState === "expired") return "expired";
  return "unknown";
}

/* Pick the date this billing state ends — i.e. when status changes.
   For cancelling: the cancel_at or current_period_end (whichever set).
   For renewing: the current_period_end (next charge).
   For trial_with_sub: trial_end (== first charge date if not cancelled).
   For trial_no_sub: trial end (computed from auth.users.created_at).
   Returns ISO string or null. */
export function endDateIso(s) {
  if (!s) return null;
  // For cancelling subs Stripe gives us cancel_at OR current_period_end.
  // Cancel_at is the explicit "this is when it dies" timestamp; prefer it.
  const cancelAt = s.subscription?.cancel_at || null;
  const periodEnd = s.subscription?.current_period_end || null;
  const trialEnd = s.subscription?.trial_end || null;

  // For trialing subs (whether cancelling or not), Stripe's
  // current_period_end can be null (API 2025-04-30+ shape mismatch).
  // Fall back to trial_end for the period boundary.
  const status = s.subscription?.status;
  const periodOrTrial = (status === "trialing")
    ? (periodEnd || trialEnd)
    : periodEnd;

  if (cancelAt) return cancelAt;
  if (periodOrTrial) return periodOrTrial;
  // No Stripe sub — trial gate decides. The hook computes trialEnd
  // from auth.users.created_at; if it's exposed, use it.
  if (s.trialEnd) {
    return s.trialEnd instanceof Date ? s.trialEnd.toISOString() : s.trialEnd;
  }
  return null;
}

/* Structured summary for the Suscripción sheet hero — one place to
   describe the visual treatment per state. Returns:
     {
       state,        // classifyBillingState output
       title,        // i18n key for the hero title
       endIso,       // raw ISO end date if any
       endLabel,     // human "30 de mayo de 2026" or null
       endCaption,   // i18n key for the small line above the date
                     // e.g. "Próximo cobro" / "Termina" / null
       chipText,     // i18n key for the pill-shaped emphasis line
                     // e.g. "$299 MXN" / "Sin cobros futuros" / null
       chipTone,     // "neutral" | "positive" | "warning" | "danger"
       tone,         // overall card tone — drives accent color
                     // "teal" | "amber" | "green" | "red"
       primaryCta,   // i18n key for the main button label
       secondaryCta, // i18n key for the secondary link OR null
     }

   Pure helper — used by Settings.jsx hero + tested. */
export function billingSummary(s) {
  const state = classifyBillingState(s);
  const endIso = endDateIso(s);
  const endLabel = formatLong(endIso);
  const priceStr = formatPriceMXN(planPriceCents(s));

  switch (state) {
    case "renewing":
      return {
        state, endIso, endLabel,
        title: "subscription.statusActiveTitle",
        endCaption: "subscription.heroCaptionNextCharge",
        chipText: priceStr ? `${priceStr} MXN` : null,
        chipTone: "positive",
        tone: "teal",
        primaryCta: "subscription.managePortalCta",
        secondaryCta: "subscription.pauseCta",
      };
    case "cancelling":
      return {
        state, endIso, endLabel,
        title: "subscription.heroTitleCancelling",
        endCaption: "subscription.heroCaptionAccessEnds",
        chipText: "subscription.heroChipNoMoreCharges",
        chipTone: "warning",
        tone: "amber",
        primaryCta: "subscription.reactivateCta",
        secondaryCta: null,
      };
    case "trial_with_sub":
      return {
        state, endIso, endLabel,
        title: "subscription.heroTitleTrialWithSub",
        endCaption: "subscription.heroCaptionFirstCharge",
        chipText: priceStr ? `${priceStr} MXN` : null,
        chipTone: "positive",
        tone: "teal",
        primaryCta: "subscription.managePortalCta",
        secondaryCta: "subscription.pauseCta",
      };
    case "trial_no_sub":
      return {
        state, endIso, endLabel,
        title: "subscription.statusTrialTitle",
        endCaption: "subscription.heroCaptionTrialEnds",
        chipText: "subscription.heroChipFreeTrial",
        chipTone: "positive",
        tone: "teal",
        primaryCta: "subscription.subscribeCta",
        secondaryCta: null,
      };
    case "trial_expiring_today":
      return {
        state, endIso: null, endLabel: null,
        title: "subscription.statusTrialTitle",
        endCaption: null,
        chipText: "subscription.heroChipTrialEndsToday",
        chipTone: "warning",
        tone: "amber",
        primaryCta: "subscription.subscribeCta",
        secondaryCta: null,
      };
    case "past_due":
      return {
        state, endIso, endLabel,
        title: "subscription.statusPastDueTitle",
        endCaption: null,
        chipText: "subscription.heroChipPastDue",
        chipTone: "danger",
        tone: "amber",
        primaryCta: "subscription.fixPaymentLongCta",
        secondaryCta: null,
      };
    case "comp":
      return {
        state, endIso: null, endLabel: null,
        title: "subscription.statusCompTitle",
        endCaption: null,
        chipText: "subscription.heroChipComp",
        chipTone: "positive",
        tone: "green",
        primaryCta: null,
        secondaryCta: null,
      };
    case "expired":
      return {
        state, endIso: null, endLabel: null,
        title: "subscription.statusExpiredTitle",
        endCaption: null,
        chipText: null,
        chipTone: "neutral",
        tone: "red",
        primaryCta: "subscription.subscribeCta",
        secondaryCta: null,
      };
    default:
      return {
        state, endIso: null, endLabel: null,
        title: "subscription.statusLoading",
        endCaption: null,
        chipText: null,
        chipTone: "neutral",
        tone: "teal",
        primaryCta: null,
        secondaryCta: null,
      };
  }
}
export function planPriceCents(s) {
  const priceId = s?.subscription?.stripe_price_id;
  // We can't read env vars from the browser, so we infer plan by amount
  // shape elsewhere. For now: assume monthly unless explicitly annual
  // (priceId contains "annual" or matches our known annual).
  // The actual price ids change between test/live, so a heuristic is
  // safer than a hardcoded list — the magnitude is what matters for
  // the user-facing sentence.
  if (priceId && /annual|year|yr/i.test(priceId)) return PRICE_ANNUAL_CENTS;
  return PRICE_MONTHLY_CENTS;
}

/* The terse one-liner for the Settings row sub-line. ALWAYS includes
   either a date (when relevant) or a clear "no charges" affirmation —
   never just "Pro" without context. */
export function rowSubLine(s, t) {
  const state = classifyBillingState(s);
  const endIso = endDateIso(s);
  const endShort = formatShort(endIso);

  switch (state) {
    case "loading": return t("subscription.statusLoading");
    case "comp":    return t("subscription.rowSubComp");
    case "past_due": return t("subscription.rowSubPastDue");
    case "cancelling":
      return endShort
        ? t("subscription.rowSubProCancelling", { date: endShort })
        : t("subscription.rowSubProActiveNoDate");
    case "renewing":
      return endShort
        ? t("subscription.rowSubProActive", { date: endShort })
        : t("subscription.rowSubProActiveNoDate");
    case "trial_with_sub":
      return endShort
        ? t("subscription.rowSubProActive", { date: endShort })
        : t("subscription.rowSubProActiveNoDate");
    case "trial_expiring_today":
      return t("subscription.rowSubTrialEndsToday");
    case "trial_no_sub":
      return endShort
        ? t("subscription.rowSubTrial", { date: endShort })
        : t("subscription.statusTrial");
    case "expired": return t("subscription.rowSubExpired");
    default: return t("subscription.statusActive");
  }
}

/* Full sentence for the Suscripción sheet hero — explicitly answers
   "will I be charged, when, and how much". */
export function chargeLine(s, t) {
  const state = classifyBillingState(s);
  const endIso = endDateIso(s);
  const endLong = formatLong(endIso);
  const priceStr = formatPriceMXN(planPriceCents(s));

  switch (state) {
    case "comp":      return t("subscription.chargeLineComp");
    case "past_due":  return t("subscription.chargeLinePastDue");
    case "cancelling":
      return endLong
        ? t("subscription.chargeLineCancelling", { date: endLong })
        : t("subscription.chargeLineCancellingNoDate");
    case "renewing":
      return (endLong && priceStr)
        ? t("subscription.chargeLineRenewing", { amount: priceStr, date: endLong })
        : t("subscription.chargeLineRenewingNoDate", { amount: priceStr });
    case "trial_with_sub":
      return (endLong && priceStr)
        ? t("subscription.chargeLineTrialWithSub", { date: endLong, amount: priceStr })
        : t("subscription.chargeLineRenewingNoDate", { amount: priceStr });
    case "trial_expiring_today":
      return t("subscription.chargeLineTrialEndsToday");
    case "trial_no_sub":
      return endLong
        ? t("subscription.chargeLineTrialNoSub", { date: endLong })
        : t("subscription.chargeLineTrialNoSubNoDate");
    case "expired": return t("subscription.chargeLineExpired");
    default: return "";
  }
}
