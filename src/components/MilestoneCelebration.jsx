import { useEffect, useRef } from "react";
import { useCardigan } from "../context/CardiganContext";
import { useT } from "../i18n/index";
import { haptic } from "../utils/haptics";

/* ── MilestoneCelebration ─────────────────────────────────────────────
   Watches three context arrays and fires a one-time success toast +
   haptic when the user transitions from 0→1 on each. Fires once per
   user per event via localStorage so a refresh after the celebration
   doesn't replay it.

   Mounted at App level so a milestone fires regardless of which
   screen the user is on when they cross the threshold (e.g. they
   record a payment from the Patient expediente, not from Finances).

   Why a toast instead of a confetti modal:
     - The PR explicitly preserves the toast pattern as the activation
       moment; modals would interrupt the flow ("just added a patient,
       now confirm a celebration").
     - Toasts already auto-dismiss; the haptic + visible message is
       enough emotional anchor without breaking the user's task. */

const STORAGE_PREFIX = "cardigan.milestone";

function alreadyCelebrated(userId, key) {
  if (!userId) return true;
  try { return localStorage.getItem(`${STORAGE_PREFIX}.${key}.${userId}`) === "1"; }
  catch { return true; } // private mode — pretend yes, fail-quiet
}

function markCelebrated(userId, key) {
  if (!userId) return;
  try { localStorage.setItem(`${STORAGE_PREFIX}.${key}.${userId}`, "1"); }
  catch { /* private mode — fine */ }
}

export function MilestoneCelebration({ userId, accessState }) {
  const { t } = useT();
  const ctx = useCardigan() || {};
  // Mirror the latest showSuccess into a ref so the firing effect
  // doesn't need to re-run when the function identity changes (it's
  // unstable across renders since it closes over the toast queue).
  const showSuccessRef = useRef(ctx.showSuccess);
  useEffect(() => { showSuccessRef.current = ctx.showSuccess; }, [ctx.showSuccess]);

  const patientsLen = ctx.patients?.length || 0;
  // CardiganContext exposes `upcomingSessions` (display-enriched) — for
  // a 0→1 transition the enrichment doesn't matter, so we just read
  // length off that. Using the same source the rest of the app does
  // keeps the trigger consistent with what the user sees.
  const sessionsLen = ctx.upcomingSessions?.length || 0;
  const paymentsLen = ctx.payments?.length || 0;

  // Track the previous count so we only fire on a strict 0→1 transition.
  // Using a ref means we don't re-fire on every render once the array
  // grows past 1 — only the very first crossing.
  const prevPatients = useRef(patientsLen);
  const prevSessions = useRef(sessionsLen);
  const prevPayments = useRef(paymentsLen);

  useEffect(() => {
    if (!userId) return;
    // Suppress on the admin "view as user" + demo paths — those flows
    // come in with arrays already populated (no 0→1 transition on a
    // real user) but we belt-and-braces it via accessState too.
    if (!accessState || accessState === "loading") return;

    const fire = (key, message) => {
      if (alreadyCelebrated(userId, key)) return;
      markCelebrated(userId, key);
      haptic.success();
      showSuccessRef.current?.(message);
    };

    if (prevPatients.current === 0 && patientsLen >= 1) {
      fire("firstPatient", t("milestone.firstPatient"));
    }
    if (prevSessions.current === 0 && sessionsLen >= 1) {
      fire("firstSession", t("milestone.firstSession"));
    }
    if (prevPayments.current === 0 && paymentsLen >= 1) {
      fire("firstPayment", t("milestone.firstPayment"));
    }

    prevPatients.current = patientsLen;
    prevSessions.current = sessionsLen;
    prevPayments.current = paymentsLen;
  }, [userId, accessState, patientsLen, sessionsLen, paymentsLen, t]);

  return null;
}
