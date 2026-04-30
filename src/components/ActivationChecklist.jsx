import { useMemo, useEffect, useRef } from "react";
import { useCardigan } from "../context/CardiganContext";
import { useT } from "../i18n/index";
import { haptic } from "../utils/haptics";
import { track as analyticsTrack } from "../lib/analytics";
import { IconCheck } from "./Icons";

/* ── ActivationChecklist ──────────────────────────────────────────────
   Four-step "set up your Cardigan" prompt that shows on Home for
   trial users until they've completed each milestone:
     1. Add first patient
     2. Log first session
     3. Record first payment
     4. Write first note

   State is derived live from CardiganContext — no localStorage flag
   needed for the strike-throughs, only for the dismiss-when-complete
   bit (so a user who finishes all four doesn't see the "Listo" empty
   state forever, but gets it once and is then left alone). The
   component self-hides once trial expires or the user dismisses. */

export function ActivationChecklist({ userId, accessState, onNavigate }) {
  const { t } = useT();
  const ctx = useCardigan() || {};
  const { patients, sessions, payments, notes, subscription, showSuccess } = ctx;

  const dismissed = useMemo(() => {
    if (!userId) return false;
    try { return localStorage.getItem(`cardigan.activation.dismissed.${userId}`) === "1"; }
    catch { return false; }
  }, [userId]);

  const stepStates = useMemo(() => ({
    patient: (patients || []).length > 0,
    session: (sessions || []).length > 0,
    payment: (payments || []).length > 0,
    note: (notes || []).length > 0,
  }), [patients, sessions, payments, notes]);

  const allDone = stepStates.patient && stepStates.session && stepStates.payment && stepStates.note;

  // Persist the "all done, hide me from now on" bit. Runs in render
  // intentionally — the localStorage write is idempotent and avoids a
  // useEffect-shaped layer of indirection for a one-shot flag.
  if (allDone && !dismissed && userId) {
    try { localStorage.setItem(`cardigan.activation.dismissed.${userId}`, "1"); }
    catch { /* private mode — fine */ }
  }

  // Reward the user with +5 trial days the moment all 4 steps cross
  // 0→done. Server-side idempotent (unique on (user_id,reason)), so
  // a refresh + re-render here can't stack the bonus. Fired at most
  // once per browser via a localStorage flag too — belt and braces.
  const grantedRef = useRef(false);
  useEffect(() => {
    if (!userId) return;
    if (accessState !== "trial") return;
    if (!allDone) return;
    if (grantedRef.current) return;
    let claimed = false;
    try { claimed = localStorage.getItem(`cardigan.activation.bonusGranted.${userId}`) === "1"; }
    catch { /* fall through */ }
    if (claimed) return;
    grantedRef.current = true;
    (async () => {
      const res = await subscription?.grantTrialExtension?.("activation_complete");
      try { localStorage.setItem(`cardigan.activation.bonusGranted.${userId}`, "1"); }
      catch { /* private mode — fine */ }
      if (res?.ok && res.granted) {
        haptic.success();
        showSuccess?.(t("activation.bonusToast"));
        analyticsTrack("activation_complete", { bonus_days: res.totalDays });
      }
    })();
  }, [userId, accessState, allDone, subscription, showSuccess, t]);

  // Per-step transitions — track once per (user, step) via
  // localStorage so a re-render doesn't re-fire. Events feed the
  // funnel-analysis dashboards in PostHog.
  useEffect(() => {
    if (!userId) return;
    if (accessState !== "trial") return;
    for (const [step, done] of Object.entries(stepStates)) {
      if (!done) continue;
      const key = `cardigan.activation.tracked.${step}.${userId}`;
      try {
        if (localStorage.getItem(key) === "1") continue;
        analyticsTrack("activation_step_completed", { step });
        localStorage.setItem(key, "1");
      } catch { /* private mode — fine */ }
    }
  }, [userId, accessState, stepStates]);

  // Hide for non-trial users (paid + comp + admin already pass), users
  // who already finished + had it dismissed, and users with no id.
  if (!userId) return null;
  if (accessState !== "trial") return null;
  if (allDone && dismissed) return null;

  const steps = [
    { key: "patient", label: t("activation.stepPatient"), nav: "patients" },
    { key: "session", label: t("activation.stepSession"), nav: "agenda" },
    { key: "payment", label: t("activation.stepPayment"), nav: "finances" },
    { key: "note", label: t("activation.stepNote"), nav: "archivo" },
  ];

  return (
    <div style={{
      padding: "16px 18px 18px",
      borderRadius: "var(--radius-lg, 16px)",
      background: "var(--cream)",
      border: "1px solid var(--cream-deeper, #EFE7DA)",
      marginBottom: 16,
    }}>
      <div style={{
        fontFamily: "var(--font-d)", fontWeight: 800, fontSize: 15,
        color: "var(--charcoal)", letterSpacing: "-0.2px", marginBottom: 4,
      }}>
        {t("activation.title")}
      </div>
      <div style={{ fontSize: 12, color: "var(--charcoal-md)", marginBottom: 12, lineHeight: 1.4 }}>
        {t("activation.subtitle")}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {steps.map((step) => {
          const done = stepStates[step.key];
          return (
            <button
              key={step.key}
              type="button"
              onClick={() => onNavigate?.(step.nav)}
              style={{
                display: "flex", alignItems: "center", gap: 10,
                padding: "10px 12px",
                background: "var(--white)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius)",
                cursor: "pointer",
                fontSize: 13,
                color: "var(--charcoal)",
                textAlign: "left",
                width: "100%",
                fontFamily: "inherit",
              }}>
              <span style={{
                width: 22, height: 22, borderRadius: "50%",
                display: "inline-flex", alignItems: "center", justifyContent: "center",
                background: done ? "var(--green)" : "transparent",
                border: done ? "none" : "1.5px solid var(--charcoal-xl)",
                color: "var(--white)",
                flexShrink: 0,
              }}>
                {done && <IconCheck size={12} />}
              </span>
              <span style={{
                flex: 1,
                textDecoration: done ? "line-through" : "none",
                color: done ? "var(--charcoal-md)" : "var(--charcoal)",
                fontWeight: done ? 500 : 600,
              }}>
                {step.label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
