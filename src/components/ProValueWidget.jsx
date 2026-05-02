import { useMemo } from "react";
import { useCardigan } from "../context/CardiganContext";
import { useT } from "../i18n/index";
import { computeProValue } from "../utils/proValue.js";
import { IconSparkle } from "./Icons";
import { formatMXN } from "../utils/format";

/* ── ProValueWidget ───────────────────────────────────────────────────
   Tiny "Pro paid for itself" framing for the Settings → plan panel.
   Rendered only for active subscribers with enough historic data —
   the helper returns null below the activation threshold, and we
   render nothing. */
export function ProValueWidget() {
  // CardiganContext exposes `upcomingSessions` (display-enriched). The
  // helper iterates raw rows looking at `status` + `date` only, so the
  // enrichment doesn't change its output but we still pass the same
  // array the rest of the UI consumes.
  const { upcomingSessions, payments } = useCardigan() || {};
  const { t } = useT();

  const result = useMemo(
    () => computeProValue(upcomingSessions, payments, new Date()),
    [upcomingSessions, payments]
  );

  if (!result) return null;
  const { sessionsCount, earnedMxn, proSharePct } = result;
  // Hide the widget entirely on a bone-dry month — a percentage line
  // that says "Pro is 100% of your month" reads like a guilt trip.
  if (sessionsCount === 0 && earnedMxn === 0) return null;

  return (
    <div style={{
      padding: "16px 16px",
      borderRadius: "var(--radius-lg, 16px)",
      background: "var(--cream)",
      marginBottom: 14,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
        <div style={{
          width: 32, height: 32, borderRadius: "50%",
          display: "flex", alignItems: "center", justifyContent: "center",
          background: "var(--white)", color: "var(--teal-dark)",
        }}>
          <IconSparkle size={16} />
        </div>
        <div style={{ fontFamily: "var(--font-d)", fontWeight: 800, fontSize: 14, color: "var(--charcoal)" }}>
          {t("subscription.valueWidgetTitle")}
        </div>
      </div>
      <div style={{
        display: "grid",
        gridTemplateColumns: earnedMxn > 0 ? "repeat(2, 1fr)" : "1fr",
        gap: 12,
      }}>
        <Stat
          value={String(sessionsCount)}
          label={t("subscription.valueSessionsThisMonth")}
        />
        {earnedMxn > 0 && (
          <Stat
            value={`${formatMXN(earnedMxn)}`}
            label={t("subscription.valueEarnedThisMonth")}
          />
        )}
      </div>
      {proSharePct !== null && earnedMxn > 0 && (
        <div style={{
          marginTop: 12, paddingTop: 10,
          borderTop: "1px solid rgba(0,0,0,0.06)",
          fontSize: 12, color: "var(--charcoal-md)", lineHeight: 1.5,
        }}>
          {t("subscription.valueShareOfMonth", { pct: proSharePct.toLocaleString("es-MX") })}
        </div>
      )}
    </div>
  );
}

function Stat({ value, label }) {
  return (
    <div>
      <div style={{ fontFamily: "var(--font-d)", fontSize: 24, fontWeight: 800, color: "var(--charcoal)", lineHeight: 1 }}>
        {value}
      </div>
      <div style={{ fontSize: 11, color: "var(--charcoal-md)", marginTop: 4, lineHeight: 1.4 }}>
        {label}
      </div>
    </div>
  );
}
