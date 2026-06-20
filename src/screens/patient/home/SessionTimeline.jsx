import { memo } from "react";
import { shortDateToISO, formatShortDateWithYear } from "../../../utils/dates";
import { IconUsers } from "../../../components/Icons";
import { MODALITY_LABEL, MODALITY_ICON, MODALITY_COLOR, STATUS_LABEL, dayName } from "./constants";

/* ── SessionTimeline ──────────────────────────────────────────────
   Vertical timeline rendering of past sessions. Each row has a
   status dot connected by a soft dashed line; the dot color matches
   the session status (green completed, amber charged, red cancelled,
   teal scheduled). Reads as a journey, not a flat log. */
export const SessionTimeline = memo(function SessionTimeline({ sessions, theme }) {
  return (
    <div style={{ position: "relative" }}>
      {sessions.map((session, idx) => {
        const isLast = idx === sessions.length - 1;
        // Auto-complete display rule mirrors the therapist app: a past
        // `scheduled` row reads as "Asistió" since the slot has passed
        // and the therapist didn't override it. Same predicate the
        // accounting helper uses (it counts the session as consumed).
        const displayStatus = session.status === "scheduled" ? "completed" : session.status;
        const statusColor = displayStatus === "completed" ? "var(--green)"
          : displayStatus === "charged" ? "var(--amber)"
          : displayStatus === "cancelled" ? "var(--charcoal-xl)"
          : theme.accentDark;
        const iso = shortDateToISO(session.date);
        const dateLabel = formatShortDateWithYear(new Date(iso + "T12:00:00"));
        const day = dayName(iso);
        const ModalityIcon = MODALITY_ICON[session.modality] || IconUsers;
        const modalityColor = MODALITY_COLOR[session.modality] || "var(--charcoal-xl)";
        return (
          <div
            key={session.id}
            className="list-entry-stagger"
            style={{
              "--stagger-i": Math.min(idx, 12),
              display: "flex",
              gap: 12,
              alignItems: "flex-start",
              paddingBottom: isLast ? 0 : 14,
              position: "relative",
            }}
          >
            {/* Dot + connector column */}
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flexShrink: 0, paddingTop: 2 }}>
              <span
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: "50%",
                  background: statusColor,
                  boxShadow: `0 0 0 3px ${statusColor === "var(--charcoal-xl)" ? "var(--cream-dark)" : theme.accentMist}`,
                  flexShrink: 0,
                }}
                aria-hidden="true"
              />
              {!isLast && (
                <span
                  style={{
                    width: 1,
                    flex: 1,
                    minHeight: 18,
                    background: `repeating-linear-gradient(to bottom, var(--border-lt) 0 4px, transparent 4px 8px)`,
                    marginTop: 4,
                  }}
                  aria-hidden="true"
                />
              )}
            </div>
            {/* Row body */}
            <div style={{ flex: 1, minWidth: 0, paddingBottom: 2 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 2 }}>
                <span style={{ fontFamily: "var(--font-d)", fontWeight: 700, fontSize: 14, color: "var(--charcoal)", letterSpacing: "-0.1px" }}>
                  {day}
                </span>
                <span style={{ fontSize: 12, color: "var(--charcoal-xl)", fontVariantNumeric: "tabular-nums" }}>
                  {dateLabel}
                </span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                <span style={{ fontSize: 12, color: "var(--charcoal-md)", fontVariantNumeric: "tabular-nums" }}>
                  {session.time || "—"}
                </span>
                {session.modality && (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, color: modalityColor, fontWeight: 700 }}>
                    <ModalityIcon size={11} />
                    {MODALITY_LABEL[session.modality] || ""}
                  </span>
                )}
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: statusColor,
                    textTransform: "uppercase",
                    letterSpacing: "0.04em",
                    marginLeft: "auto",
                  }}
                >
                  {STATUS_LABEL[displayStatus] || ""}
                </span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
});
