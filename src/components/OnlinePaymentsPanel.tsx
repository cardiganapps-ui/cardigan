import { useState } from "react";
import { useTherapistConnect } from "../hooks/useTherapistConnect";
import { useT } from "../i18n/index";
import { useCardiganMain } from "../context/CardiganContext";
import { IconCreditCard, IconCheck, IconRefresh } from "./Icons";

/* ── OnlinePaymentsPanel ──────────────────────────────────────────
   Therapist's view of their Stripe Connect Express account. Drives
   four UI states off the underlying status:

     absent     — never started onboarding. CTA "Empezar".
     pending    — left mid-onboarding. CTA "Continuar".
     restricted — submitted but Stripe is still verifying. Read-only
                  status with refresh button + Stripe-dashboard link.
     active     — accepting payments. Stripe dashboard CTA + a
                  "managed in Stripe" footnote so the therapist knows
                  refunds/payouts/etc. live there.

   The panel doesn't know about the surrounding sheet — it just
   renders a vertical column of UI. Mounting Settings or any other
   surface can wrap it however they like. */

export function OnlinePaymentsPanel({ user }: { user?: { id?: string } | null }) {
  const { t } = useT();
  const { showToast } = useCardiganMain();
  const c = useTherapistConnect(user);
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await c.refresh();
    } finally {
      setRefreshing(false);
    }
  };

  const handleStart = async () => {
    let r;
    try {
      r = await c.startOnboarding();
    } catch (err) {
      // Defensive — the hook itself catches all failures, but if a
      // future refactor breaks that, the click must still surface
      // something to the user instead of looking dead.
      console.error("[OnlinePaymentsPanel] handleStart threw:", err);
      r = { ok: false, error: (err as Error)?.message || "unknown" };
    }
    if (!r.ok) {
      const detail = r.error ? ` (${r.error})` : "";
      showToast(t("onlinePayments.startError") + detail, "error");
    }
  };

  const handleDashboard = async () => {
    let r;
    try {
      r = await c.openDashboard();
    } catch (err) {
      console.error("[OnlinePaymentsPanel] handleDashboard threw:", err);
      r = { ok: false, error: (err as Error)?.message || "unknown" };
    }
    if (!r.ok) {
      if (r.code === "incomplete") {
        showToast(t("onlinePayments.dashboardIncomplete"), "warning");
        return;
      }
      const detail = r.error ? ` (${r.error})` : "";
      showToast(t("onlinePayments.dashboardError") + detail, "error");
    }
  };

  if (c.status === "loading") {
    return (
      <div style={{ padding: 20, textAlign: "center", color: "var(--charcoal-md)", fontSize: "var(--text-sm)" }}>
        {t("onlinePayments.loading")}
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Status hero */}
      <div
        className="card"
        style={{
          padding: 18,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          textAlign: "center",
          gap: 10,
          background: c.status === "active" ? "var(--green-bg, var(--cream))" : "var(--cream)",
        }}
      >
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: "50%",
            background: c.status === "active" ? "var(--green-pale, var(--teal-pale))" : "var(--teal-pale)",
            color: c.status === "active" ? "var(--green)" : "var(--teal-dark)",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {c.status === "active" ? <IconCheck size={26} /> : <IconCreditCard size={26} />}
        </div>
        <div style={{ fontWeight: 700, fontSize: "var(--text-md)", color: "var(--charcoal)" }}>
          {c.status === "active"
            ? t("onlinePayments.statusActiveTitle")
            : c.status === "restricted"
              ? t("onlinePayments.statusRestrictedTitle")
              : c.status === "pending"
                ? t("onlinePayments.statusPendingTitle")
                : t("onlinePayments.statusAbsentTitle")}
        </div>
        <div style={{ fontSize: "var(--text-sm)", color: "var(--charcoal-md)", lineHeight: 1.5 }}>
          {c.status === "active"
            ? t("onlinePayments.statusActiveBody")
            : c.status === "restricted"
              ? t("onlinePayments.statusRestrictedBody")
              : c.status === "pending"
                ? t("onlinePayments.statusPendingBody")
                : t("onlinePayments.statusAbsentBody")}
        </div>
      </div>

      {/* Action buttons */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {(c.status === "absent" || c.status === "pending") && (
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleStart}
            disabled={c.busy}
            style={{ width: "100%" }}
          >
            {c.busy
              ? t("onlinePayments.busy")
              : c.status === "absent"
                ? t("onlinePayments.startCta")
                : t("onlinePayments.continueCta")}
          </button>
        )}

        {(c.status === "active" || c.status === "restricted") && (
          <>
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleDashboard}
              disabled={c.busy}
              style={{ width: "100%" }}
            >
              {t("onlinePayments.openDashboard")}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={handleRefresh}
              disabled={refreshing || c.busy}
              style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}
            >
              <IconRefresh size={14} />
              {refreshing ? t("onlinePayments.refreshing") : t("onlinePayments.refresh")}
            </button>
          </>
        )}
      </div>

      {/* "How it works" footnote — stays visible across all states so a
          therapist deciding whether to start onboarding can read the
          terms before tapping. */}
      <div
        style={{
          padding: 14,
          borderRadius: "var(--radius)",
          background: "var(--cream)",
          fontSize: "var(--text-xs)",
          color: "var(--charcoal-md)",
          lineHeight: 1.6,
        }}
      >
        <div style={{ fontWeight: 700, color: "var(--charcoal)", marginBottom: 6 }}>
          {t("onlinePayments.howItWorks")}
        </div>
        <ul style={{ margin: 0, paddingLeft: 16 }}>
          <li>{t("onlinePayments.bullet1")}</li>
          <li>{t("onlinePayments.bullet2")}</li>
          <li>{t("onlinePayments.bullet3")}</li>
          <li>{t("onlinePayments.bullet4")}</li>
        </ul>
      </div>
    </div>
  );
}
