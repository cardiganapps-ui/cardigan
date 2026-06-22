import { useState, useEffect, useMemo } from "react";
import { shortDateToISO } from "../../utils/dates";
import { useT } from "../../i18n/index";
import { useCardigan } from "../../context/CardiganContext";

/* Reads upcoming sessions from context, computes the wall-clock
   moment each reminder will fire (session_time − minutes), filters
   to the next 24h, and renders a compact list. Helps therapists
   reconcile "what does the 30-min setting actually do" against
   their real schedule — closes a meaningful clarity gap that the
   row's summary text alone can't. */
export function NextRemindersPreview({ minutes }: { minutes: number }) {
  const { t } = useT();
  const { upcomingSessions } = useCardigan();
  // `now` lives in state so React Compiler's purity rules accept the
  // useMemo below (Date.now() inside useMemo is flagged as impure).
  // It re-ticks once per minute while the sheet is open so a reminder
  // that just passed disappears from the preview without a manual
  // re-render. The interval only attaches while the component is
  // mounted, so it doesn't run when the sheet is closed.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);
  const items = useMemo(() => {
    const horizonMs = now + 24 * 60 * 60 * 1000;
    const out: { id: string; fireAt: number; sessionAt: number; patient: string }[] = [];
    for (const s of (upcomingSessions || [])) {
      if (s.status !== "scheduled") continue;
      if (!s.date || !s.time) continue;
      const iso = shortDateToISO(s.date);
      if (!iso) continue;
      const [h = "0", mi = "0"] = (s.time || "").split(":");
      const ms = new Date(`${iso}T${h.padStart(2, "0")}:${mi.padStart(2, "0")}:00`).getTime();
      if (!Number.isFinite(ms)) continue;
      const fireAt = ms - minutes * 60_000;
      if (fireAt < now || fireAt > horizonMs) continue;
      out.push({ id: s.id, fireAt, sessionAt: ms, patient: s.patient || "—" });
    }
    out.sort((a, b) => a.fireAt - b.fireAt);
    return out.slice(0, 5);
  }, [upcomingSessions, minutes, now]);

  if (items.length === 0) {
    return (
      <div style={{ marginTop: 14, padding: "10px 12px", background: "var(--cream)", borderRadius: "var(--radius)", fontSize: 12, color: "var(--charcoal-md)", lineHeight: 1.5 }}>
        {t("notifications.previewNone")}
      </div>
    );
  }

  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: "var(--charcoal-xl)", textTransform: "uppercase", letterSpacing: "0.06em", margin: "0 2px 6px" }}>
        {t("notifications.previewTitle")}
      </div>
      <div className="card" style={{ overflow: "hidden" }}>
        {items.map((it, idx) => {
          const fireDate = new Date(it.fireAt);
          const sessionDate = new Date(it.sessionAt);
          const fireH = String(fireDate.getHours()).padStart(2, "0");
          const fireM = String(fireDate.getMinutes()).padStart(2, "0");
          const sessH = String(sessionDate.getHours()).padStart(2, "0");
          const sessM = String(sessionDate.getMinutes()).padStart(2, "0");
          // "Hoy" / "Mañana" prefix relative to local-day boundary.
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          const dayDelta = Math.round((new Date(fireDate).setHours(0,0,0,0) - today.getTime()) / 86_400_000);
          const dayLabel = dayDelta <= 0 ? t("notifications.previewToday") : t("notifications.previewTomorrow");
          return (
            <div
              key={it.id}
              style={{
                padding: "10px 14px",
                borderBottom: idx < items.length - 1 ? "1px solid var(--border-lt)" : "none",
                display: "flex",
                alignItems: "center",
                gap: 10,
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "var(--charcoal)", fontFamily: "var(--font-d)", fontVariantNumeric: "tabular-nums" }}>
                  {dayLabel} · {fireH}:{fireM}
                </div>
                <div style={{ fontSize: 12, color: "var(--charcoal-md)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {t("notifications.previewLine", { patient: it.patient, sessionTime: `${sessH}:${sessM}` })}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
