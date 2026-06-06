import { useState } from "react";
import { supabase } from "../../supabaseClient";
import { useT } from "../../i18n/index";
import { useCardigan } from "../../context/CardiganContext";
import { useEscape } from "../../hooks/useEscape";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import { useSheetDrag } from "../../hooks/useSheetDrag";
import { useSheetExit } from "../../hooks/useSheetExit";
import { haptic } from "../../utils/haptics";
import {
  IconX, IconCheck, IconChevronRight,
} from "../Icons";

/* ── SessionRequestsSheet ──────────────────────────────────────────
   Therapist-facing list of pending reschedule requests. The patient
   submitted a proposed new time; the therapist accepts (session
   moves) or rejects (session stays) here, or via the email-link
   landing page — both call the same applyAccept/applyReject
   helper server-side.

   Empty state when the list drains to zero (the user just acted on
   the last one) → friendly "todo al día" message before they close
   the sheet.

   Per-row action state (`acting`) prevents double-tap. Errors land
   inline next to the row instead of via a global toast since the
   sheet is the active surface — surfacing an error on a different
   layer would leave the user wondering which row failed. */

export function SessionRequestsSheet({ onClose }) {
  const { t } = useT();
  const { rescheduleRequests = [], patients, refresh, showToast } = useCardigan();
  const [actingId, setActingId] = useState(null);
  const [rowError, setRowError] = useState({});

  const { exiting, animatedClose } = useSheetExit(true, onClose);
  const safeClose = actingId ? null : onClose;
  const safeAnimatedClose = actingId ? null : animatedClose;
  useEscape(safeAnimatedClose);
  const panelRef = useFocusTrap(true);
  const { scrollRef, setPanelEl, panelHandlers } = useSheetDrag(safeClose, { isOpen: true });
  const setPanel = (el) => {
    panelRef.current = el;
    scrollRef.current = el;
    setPanelEl(el);
  };

  const respond = async (request, action) => {
    if (actingId) return;
    setActingId(request.id);
    setRowError(s => ({ ...s, [request.id]: null }));
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const access = session?.access_token;
      if (!access) {
        setRowError(s => ({ ...s, [request.id]: t("sessionRequests.errorGeneric") }));
        return;
      }
      const res = await fetch("/api/session-request-respond", {
        method: "POST",
        headers: { "Authorization": `Bearer ${access}`, "Content-Type": "application/json" },
        body: JSON.stringify({ request_id: request.id, action }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        // The 409 codes are user-meaningful — surface a hint inline.
        const hint = body?.code === "conflict" ? t("sessionRequests.errorConflict")
          : body?.code === "stale" ? t("sessionRequests.errorStale")
          : body?.code === "race_lost" ? t("sessionRequests.errorRaceLost")
          : body?.code === "not_pending" ? t("sessionRequests.errorAlreadyResolved")
          : t("sessionRequests.errorGeneric");
        setRowError(s => ({ ...s, [request.id]: hint }));
        return;
      }
      haptic.success();
      showToast(
        action === "accept" ? t("sessionRequests.acceptedToast") : t("sessionRequests.rejectedToast"),
        "success"
      );
      refresh?.();
    } catch {
      setRowError(s => ({ ...s, [request.id]: t("sessionRequests.errorGeneric") }));
    } finally {
      setActingId(null);
    }
  };

  // Hydrate patient names from the patients array we already have.
  const patientNameById = new Map((patients || []).map(p => [p.id, p.name]));

  return (
    <div className={`sheet-overlay ${exiting ? "sheet-overlay--exit" : ""}`} onClick={safeAnimatedClose}>
      <div ref={setPanel} className={`sheet-panel ${exiting ? "sheet-panel--exit" : ""}`} role="dialog" aria-modal="true"
        onClick={(e) => e.stopPropagation()} {...panelHandlers}
        style={{ maxHeight: "min(92dvh, calc(100dvh - var(--sat) - 16px))" }}>
        <div className="sheet-handle" />
        <div className="sheet-header">
          <span className="sheet-title">{t("sessionRequests.title")}</span>
          <button className="sheet-close" aria-label={t("close")} onClick={safeAnimatedClose}>
            <IconX size={14} />
          </button>
        </div>

        <div style={{ padding: "8px 20px 24px", overflowY: "auto" }}>
          {rescheduleRequests.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon"><IconCheck size={20} /></div>
              <div className="empty-state-title">{t("sessionRequests.emptyTitle")}</div>
              <div className="empty-state-body">{t("sessionRequests.emptyBody")}</div>
            </div>
          ) : (
            <>
              <p style={{
                fontSize: 12, color: "var(--charcoal-md)",
                margin: "0 0 12px", lineHeight: 1.5,
              }}>
                {t("sessionRequests.subtitle")}
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {rescheduleRequests.map(r => {
                  const name = patientNameById.get(r.patient_id) || t("sessionRequests.unknownPatient");
                  const acting = actingId === r.id;
                  const err = rowError[r.id];
                  return (
                    <div key={r.id} style={{
                      padding: "14px 14px",
                      background: "var(--white)",
                      border: "1px solid var(--border-lt)",
                      borderRadius: "var(--radius-lg)",
                      boxShadow: "var(--shadow-sm)",
                    }}>
                      <div style={{
                        fontFamily: "var(--font-d)", fontWeight: 800, fontSize: 15,
                        color: "var(--charcoal)", marginBottom: 8,
                      }}>
                        {name}
                      </div>
                      <div style={{
                        display: "flex", alignItems: "center", gap: 8,
                        fontSize: 13, color: "var(--charcoal)",
                        fontVariantNumeric: "tabular-nums",
                        background: "var(--cream)",
                        borderRadius: "var(--radius)",
                        padding: "10px 12px",
                        marginBottom: 10,
                      }}>
                        <span style={{ color: "var(--charcoal-md)" }}>
                          {r.original_date} · {r.original_time}
                        </span>
                        <IconChevronRight size={12} style={{ color: "var(--charcoal-xl)", flexShrink: 0 }} />
                        <span style={{ fontWeight: 700 }}>
                          {r.proposed_date} · {r.proposed_time}
                        </span>
                      </div>
                      {r.patient_note && (
                        <div style={{
                          fontSize: 12, color: "var(--charcoal-md)",
                          background: "var(--white)",
                          border: "1px dashed var(--border-lt)",
                          borderRadius: "var(--radius)",
                          padding: "8px 10px",
                          marginBottom: 10,
                          lineHeight: 1.5,
                        }}>
                          <strong style={{ color: "var(--charcoal)" }}>{t("sessionRequests.noteLabel")}:</strong>{" "}
                          {r.patient_note}
                        </div>
                      )}
                      {err && (
                        <div style={{
                          fontSize: 12, color: "var(--red)",
                          background: "var(--red-bg)",
                          borderRadius: "var(--radius-sm)",
                          padding: "6px 10px",
                          marginBottom: 8,
                        }}>
                          {err}
                        </div>
                      )}
                      <div style={{ display: "flex", gap: 8 }}>
                        <button type="button"
                          onClick={() => respond(r, "accept")}
                          disabled={acting}
                          className="btn-tap"
                          style={{
                            flex: 1, height: 38,
                            background: "var(--teal)",
                            border: "none",
                            borderRadius: "var(--radius-pill)",
                            color: "var(--white)",
                            fontFamily: "inherit", fontWeight: 700, fontSize: 13,
                            cursor: "pointer",
                          }}
                        >
                          {acting ? t("saving") : t("sessionRequests.acceptCta")}
                        </button>
                        <button type="button"
                          onClick={() => respond(r, "reject")}
                          disabled={acting}
                          className="btn-tap"
                          style={{
                            flex: 1, height: 38,
                            background: "transparent",
                            border: "1px solid var(--red)",
                            borderRadius: "var(--radius-pill)",
                            color: "var(--red)",
                            fontFamily: "inherit", fontWeight: 700, fontSize: 13,
                            cursor: "pointer",
                          }}
                        >
                          {t("sessionRequests.rejectCta")}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
