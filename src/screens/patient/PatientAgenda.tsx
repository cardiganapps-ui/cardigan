import React, { useMemo, useState } from "react";
import { supabase } from "../../supabaseClient";
import { useT } from "../../i18n/index";
import { useCardigan } from "../../context/CardiganContext";
import { shortDateToISO, formatShortDateWithYear } from "../../utils/dates";
import { sessionCountsTowardBalance } from "../../utils/accounting";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import {
  IconUsers, IconCamera, IconPhone, IconHome,
  IconCalendar, IconChevronRight, IconX,
} from "../../components/Icons";
import { useEscape } from "../../hooks/useEscape";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import { useSheetDrag } from "../../hooks/useSheetDrag";
import { haptic } from "../../utils/haptics";
import { RescheduleSessionSheet } from "./RescheduleSessionSheet";
import { SheetOverlay } from "../../components/SheetOverlay";

/* ── PatientAgenda ─────────────────────────────────────────────────
   Friendly chronological list of all upcoming sessions. Past versions
   tried to mirror the therapist agenda's three-view structure
   (Día/Semana/Mes) — felt empty for a patient who usually has 1-3
   upcoming sessions visible at a time.

   This is what's here now:
     - Plain vertical list, sorted ascending by start time
     - Grouped by month with eyebrow headers ("MAYO 2026")
     - Each session is a tappable card → opens a management sheet
       with the session's details + Reprogramar / Cancelar pills
     - Empty state for accounts with no upcoming sessions
     - Past sessions excluded by default (they're visible on Inicio)

   The management sheet itself owns the action buttons; the cards
   are pure read-affordances. That keeps the list scannable and
   pushes the destructive copy ("Cancelar esta cita") into a place
   where the user has to deliberately tap a row first. */

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- loosely-typed session / portal-data rows
type Row = any;

type T = (key: string, vars?: Record<string, unknown>) => string;

const MODALITY_LABEL: Record<string, string> = {
  presencial: "Presencial",
  virtual: "Virtual",
  telefonica: "Telefónica",
  "a-domicilio": "A domicilio",
};
const MODALITY_ICON: Record<string, typeof IconUsers> = {
  presencial:    IconUsers,
  virtual:       IconCamera,
  telefonica:    IconPhone,
  "a-domicilio": IconHome,
};
const MODALITY_COLOR: Record<string, string> = {
  presencial:    "var(--modality-presencial)",
  virtual:       "var(--modality-virtual)",
  telefonica:    "var(--modality-telefonica)",
  "a-domicilio": "var(--modality-a-domicilio)",
};

const DAY_LONG  = ["Domingo","Lunes","Martes","Miércoles","Jueves","Viernes","Sábado"];
const MONTH_LONG = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];

function startOfDay(d: Date | number | string) { const x = new Date(d); x.setHours(0,0,0,0); return x; }
function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear()
      && a.getMonth() === b.getMonth()
      && a.getDate() === b.getDate();
}
function sessionStartMs(s: Row) {
  const iso = shortDateToISO(s.date);
  if (!iso) return 0;
  return new Date(`${iso}T${(s.time || "00:00")}:00`).getTime();
}
function monthLabel(d: Date) {
  return `${MONTH_LONG[d.getMonth()].toUpperCase()} ${d.getFullYear()}`;
}
function relativeLabel(sessionDate: Date, today: Date, t: T) {
  if (sameDay(sessionDate, today)) return t("patientAgenda.today");
  const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
  if (sameDay(sessionDate, tomorrow)) return t("patientAgenda.tomorrow");
  const diffDays = Math.round((sessionDate.getTime() - today.getTime()) / 86400000);
  if (diffDays >= 2 && diffDays <= 6) return t("patientAgenda.inDays", { n: diffDays });
  return null;
}

type PatientAgendaProps = {
  data: Row;
};

export function PatientAgenda({ data }: PatientAgendaProps) {
  const { t } = useT();
  const { showToast } = useCardigan();
  const { primaryPatient, primaryTherapist, sessions, rescheduleRequests = [], refresh } = data;
  // Index pending requests by session_id for O(1) lookup. Patient
  // can only have one pending request per session (DB enforces it),
  // so a Map keyed on session_id is safe.
  const pendingBySessionId = useMemo(() => {
    const m = new Map<string, Row>();
    for (const r of rescheduleRequests || []) {
      if (r.status === "pending") m.set(r.session_id, r);
    }
    return m;
  }, [rescheduleRequests]);
  const [withdrawing, setWithdrawing] = useState(false);
  const handleWithdraw = async (requestId: string) => {
    if (!requestId || withdrawing) return;
    setWithdrawing(true);
    try {
      const { data: { session: authSession } } = await supabase.auth.getSession();
      const access = authSession?.access_token;
      if (!access) { showToast(t("patientHome.cancelError"), "error"); return; }
      const res = await fetch("/api/patient-withdraw-reschedule", {
        method: "POST",
        headers: { "Authorization": `Bearer ${access}`, "Content-Type": "application/json" },
        body: JSON.stringify({ request_id: requestId }),
      });
      if (!res.ok) {
        // The most common non-ok case is the patient trying to
        // withdraw a request that the therapist just resolved (or
        // cron expired). Show a meaningful message rather than
        // generic "no pudimos cancelar" + force a refresh so the
        // patient sees the current state instead of staring at
        // a stale pending pill.
        const body = await res.json().catch(() => ({}));
        const msg = body?.code === "not_pending" || body?.code === "race_lost"
          ? t("patientAgenda.withdrawAlreadyResolved")
          : t("patientHome.cancelError");
        showToast(msg, "info");
        setActiveSession(null);
        refresh?.();
        return;
      }
      haptic.success();
      showToast(t("patientAgenda.withdrawSuccess"), "success");
      setActiveSession(null);
      refresh?.();
    } catch {
      showToast(t("patientHome.cancelError"), "error");
    } finally { setWithdrawing(false); }
  };
  // Same fallback chain PatientHome uses — keeps the dialog/email
  // copy consistent across the two cancel entry points.
  const therapistDisplayName = primaryTherapist?.therapist_full_name
    || primaryTherapist?.therapist_email?.split("@")[0]
    || "Tu profesionista";

  const [activeSession, setActiveSession] = useState<Row | null>(null);     // tap-target → opens management sheet
  const [rescheduleTarget, setRescheduleTarget] = useState<Row | null>(null);
  const [cancelTarget, setCancelTarget] = useState<Row | null>(null);
  const [cancelNote, setCancelNote] = useState("");
  const [cancelling, setCancelling] = useState(false);

  // Future sessions only, ascending by start time. Past sessions
  // surface on the Inicio screen; duplicating them here would push
  // the upcoming list below the fold without earning much.
  const upcoming = useMemo(() => {
    if (!primaryPatient) return [];
    const now = new Date();
    return (sessions || [])
      .filter((s: Row) => s.patient_id === primaryPatient.id)
      .filter((s: Row) => {
        // Cancelled stays out of the upcoming list (it's not really
        // "upcoming" anymore). Auto-completed past-scheduled also out.
        if (s.status === "cancelled") return false;
        if (sessionCountsTowardBalance(s, now)) return false;
        return s.status === "scheduled";
      })
      .sort((a: Row, b: Row) => sessionStartMs(a) - sessionStartMs(b));
  }, [sessions, primaryPatient]);

  // Group ascending list by month for the section headers. We carry
  // the iso month string (e.g. "2026-05") as the key + a Date for
  // formatting the eyebrow.
  const groups = useMemo(() => {
    const out: Array<{ key: string; when: Date; items: Row[] }> = [];
    let currentKey: string | null = null;
    for (const s of upcoming) {
      const iso = shortDateToISO(s.date);
      if (!iso) continue;
      const ymKey = iso.slice(0, 7);
      if (ymKey !== currentKey) {
        currentKey = ymKey;
        out.push({ key: ymKey, when: new Date(iso + "T12:00:00"), items: [] });
      }
      out[out.length - 1].items.push(s);
    }
    return out;
  }, [upcoming]);

  const requestCancel = (s: Row) => {
    setActiveSession(null);
    setCancelTarget(s); setCancelNote("");
  };
  const dismissCancel = () => { if (!cancelling) { setCancelTarget(null); setCancelNote(""); } };
  const confirmCancel = async () => {
    if (!cancelTarget || cancelling) return;
    setCancelling(true);
    try {
      const { data: { session: authSession } } = await supabase.auth.getSession();
      const access = authSession?.access_token;
      if (!access) { showToast(t("patientHome.cancelError"), "error"); return; }
      const res = await fetch("/api/patient-cancel-session", {
        method: "POST",
        headers: { "Authorization": `Bearer ${access}`, "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: cancelTarget.id, note: cancelNote.trim() || undefined }),
      });
      if (!res.ok) { showToast(t("patientHome.cancelError"), "error"); return; }
      haptic.success();
      showToast(t("patientHome.cancelSuccess"), "success");
      refresh?.();
      setCancelTarget(null); setCancelNote("");
    } catch {
      showToast(t("patientHome.cancelError"), "error");
    } finally { setCancelling(false); }
  };

  const requestReschedule = (s: Row) => {
    setActiveSession(null);
    setRescheduleTarget(s);
  };

  if (!primaryPatient) {
    return (
      <div style={{ padding: "20px 16px", color: "var(--charcoal-md)", fontSize: 14 }}>
        {t("patientAgenda.noPatient")}
      </div>
    );
  }

  return (
    <div style={{ padding: "16px 16px 24px" }}>
      {/* Header */}
      <div style={{ marginBottom: 18 }}>
        <h1 style={{
          fontFamily: "var(--font-d)", fontWeight: 800,
          fontSize: 24, color: "var(--charcoal)", letterSpacing: "-0.3px",
          margin: 0, marginBottom: 4,
        }}>
          {t("patientAgenda.title")}
        </h1>
        <p style={{
          fontSize: 13, color: "var(--charcoal-md)", margin: 0,
        }}>
          {upcoming.length === 0
            ? t("patientAgenda.subtitleEmpty")
            : t("patientAgenda.subtitleCount", { n: upcoming.length })}
        </p>
      </div>

      {upcoming.length === 0 ? (
        <EmptyAgenda t={t} />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          {groups.map(group => (
            <section key={group.key}>
              <div style={{
                fontSize: 11, fontWeight: 700,
                letterSpacing: "0.07em",
                color: "var(--charcoal-xl)",
                marginBottom: 10,
              }}>
                {monthLabel(group.when)}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {group.items.map(s => (
                  <SessionRow
                    key={s.id}
                    s={s}
                    pending={pendingBySessionId.get(s.id) || null}
                    onTap={() => setActiveSession(s)}
                    t={t}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {/* Management sheet — opens on row tap; surfaces details +
          the two action pills. Reschedule + cancel handlers swap the
          sheet for the dedicated flow (RescheduleSessionSheet or the
          cancel ConfirmDialog) so the user only ever sees one modal
          surface at a time. */}
      {activeSession && (
        <SessionManageSheet
          session={activeSession}
          pending={pendingBySessionId.get(activeSession.id) || null}
          withdrawing={withdrawing}
          onClose={() => setActiveSession(null)}
          onReschedule={requestReschedule}
          onCancel={requestCancel}
          onWithdraw={handleWithdraw}
        />
      )}

      <RescheduleSessionSheet
        open={!!rescheduleTarget}
        session={rescheduleTarget}
        onClose={() => setRescheduleTarget(null)}
        onRescheduled={() => { refresh?.(); }}
      />

      <ConfirmDialog
        open={!!cancelTarget}
        title={cancelTarget
          ? t("patientHome.cancelDialogTitle", {
              date: formatShortDateWithYear(new Date(shortDateToISO(cancelTarget.date) + "T12:00:00")),
            })
          : ""}
        body={t("patientHome.cancelDialogBody", { name: therapistDisplayName })}
        bodyExtra={
          <textarea
            value={cancelNote}
            onChange={(e) => setCancelNote(e.target.value)}
            placeholder={t("patientHome.cancelNotePlaceholder")}
            rows={2}
            maxLength={500}
            disabled={cancelling}
            style={{
              width: "100%", padding: 10,
              border: "1px solid var(--border)",
              borderRadius: "var(--radius)",
              fontFamily: "var(--font)", fontSize: "var(--text-md)",
              color: "var(--charcoal)", background: "var(--white)",
              resize: "vertical", boxSizing: "border-box",
            }}
          />
        }
        confirmLabel={t("patientHome.cancelConfirmCta")}
        cancelLabel={t("patientHome.cancelKeepCta")}
        destructive
        busy={cancelling}
        onConfirm={confirmCancel}
        onCancel={dismissCancel}
      />
    </div>
  );
}

// ── Session row ─────────────────────────────────────────────────────

function SessionRow({ s, pending, onTap, t }: { s: Row; pending: Row | null; onTap: () => void; t: T }) {
  const ModalityIcon = MODALITY_ICON[s.modality] || IconUsers;
  const modalityColor = MODALITY_COLOR[s.modality] || "var(--teal-dark)";
  const modalityLabel = MODALITY_LABEL[s.modality] || MODALITY_LABEL.presencial;
  const iso = shortDateToISO(s.date);
  const sessionDate = iso ? new Date(iso + "T12:00:00") : null;
  const today = startOfDay(new Date());
  const dayName = sessionDate ? DAY_LONG[sessionDate.getDay()] : "";
  const dayNum  = sessionDate ? sessionDate.getDate() : "";
  const monthShort = sessionDate ? MONTH_LONG[sessionDate.getMonth()].slice(0, 3) : "";
  const time = s.time || "—";
  const duration = s.duration ? `${s.duration} min` : null;
  const relative = sessionDate ? relativeLabel(sessionDate, today, t) : null;

  return (
    <button
      type="button"
      onClick={onTap}
      className="btn-tap"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
        width: "100%",
        padding: "14px 14px",
        background: "var(--white)",
        border: "1px solid var(--border-lt)",
        borderRadius: "var(--radius-lg)",
        boxShadow: "var(--shadow-sm)",
        cursor: "pointer",
        textAlign: "left",
        fontFamily: "inherit",
        WebkitTapHighlightColor: "transparent",
      }}
    >
      {/* Date stamp — column showing day name + number, like a tear-
          off calendar page. Reads quickly across many rows. */}
      <div style={{
        width: 50, flexShrink: 0,
        display: "flex", flexDirection: "column", alignItems: "center",
        padding: "6px 0",
        background: "var(--cream)",
        borderRadius: "var(--radius)",
      }}>
        <span style={{
          fontSize: 9, fontWeight: 700, letterSpacing: "0.06em",
          color: "var(--charcoal-xl)",
          textTransform: "uppercase",
        }}>
          {dayName.slice(0, 3)}
        </span>
        <span style={{
          fontFamily: "var(--font-d)", fontWeight: 800, fontSize: 20,
          color: "var(--charcoal)", lineHeight: 1, marginTop: 2,
        }}>
          {dayNum}
        </span>
        <span style={{
          fontSize: 9, fontWeight: 600, letterSpacing: "0.04em",
          color: "var(--charcoal-xl)", marginTop: 2,
          textTransform: "lowercase",
        }}>
          {monthShort}
        </span>
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontFamily: "var(--font-d)", fontWeight: 800, fontSize: 16,
          color: "var(--charcoal)",
          fontVariantNumeric: "tabular-nums",
          marginBottom: 2,
        }}>
          {time}
          {duration && (
            <span style={{ fontSize: 12, fontWeight: 600, color: "var(--charcoal-md)" }}>
              {" · "}{duration}
            </span>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <span style={{
            display: "inline-flex", alignItems: "center", gap: 4,
            padding: "2px 8px", borderRadius: "var(--radius-pill)",
            background: `${modalityColor}1A`, color: modalityColor,
            fontSize: 10, fontWeight: 700, letterSpacing: "0.04em",
          }}>
            <ModalityIcon size={10} />
            {modalityLabel}
          </span>
          {relative && !pending && (
            <span style={{
              fontSize: 11, fontWeight: 700,
              color: "var(--teal-dark)",
            }}>
              {relative}
            </span>
          )}
          {pending && (
            <span style={{
              display: "inline-flex", alignItems: "center", gap: 4,
              padding: "2px 8px", borderRadius: "var(--radius-pill)",
              background: "var(--amber-bg)", color: "var(--amber)",
              fontSize: 10, fontWeight: 700, letterSpacing: "0.04em",
            }}>
              {t("patientAgenda.pendingBadge")}
            </span>
          )}
        </div>
        {pending && (
          <div style={{
            marginTop: 6,
            fontSize: 11,
            color: "var(--charcoal-md)",
            fontVariantNumeric: "tabular-nums",
          }}>
            {t("patientAgenda.pendingMoveTo", {
              date: pending.proposed_date,
              time: pending.proposed_time,
            })}
          </div>
        )}
      </div>

      <IconChevronRight size={14} style={{ color: "var(--charcoal-xl)", flexShrink: 0 }} />
    </button>
  );
}

// ── Session management sheet ────────────────────────────────────────

function SessionManageSheet({ session, pending, withdrawing, onClose, onReschedule, onCancel, onWithdraw }: {
  session: Row;
  pending: Row | null;
  withdrawing: boolean;
  onClose: () => void;
  onReschedule: (s: Row) => void;
  onCancel: (s: Row) => void;
  onWithdraw: (requestId: string) => void;
}) {
  const { t } = useT();
  useEscape(onClose);
  const panelRef = useFocusTrap(true);
  const { scrollRef, setPanelEl, panelHandlers } = useSheetDrag(onClose, { isOpen: true });
  const setPanel = (el: HTMLElement | null) => {
    panelRef.current = el;
    scrollRef.current = el;
    setPanelEl(el);
  };

  const ModalityIcon = MODALITY_ICON[session.modality] || IconUsers;
  const modalityColor = MODALITY_COLOR[session.modality] || "var(--teal-dark)";
  const modalityLabel = MODALITY_LABEL[session.modality] || MODALITY_LABEL.presencial;
  const iso = shortDateToISO(session.date);
  const sessionDate = iso ? new Date(iso + "T12:00:00") : null;
  const dayName = sessionDate ? DAY_LONG[sessionDate.getDay()] : "";
  const dateLine = sessionDate
    ? `${dayName} ${sessionDate.getDate()} de ${MONTH_LONG[sessionDate.getMonth()]}`
    : session.date;
  const time = session.time || "—";
  const duration = session.duration ? `${session.duration} min` : null;
  // Capture "now" once at sheet open via lazy useState initializer.
  // react-hooks/purity rejects Date.now() called in the render body
  // (and even inside useMemo with deps); useState's initializer is
  // the canonical escape hatch since it only runs on mount.
  // The sheet stays mounted for seconds at a time per interaction,
  // so a stale "now" can't matter — and the server validates
  // the same "is future" rule on cancel anyway.
  const [openedAt] = useState(() => Date.now());
  const isFuture = sessionStartMs(session) > openedAt;

  return (
    <SheetOverlay onClose={onClose}>
      <div ref={setPanel} className="sheet-panel" role="dialog" aria-modal="true" aria-label={t("patientAgenda.manageTitle")}
        {...panelHandlers}
        style={{ maxHeight: "min(92lvh, calc(100lvh - var(--sat) - 16px))" }}>
        <div className="sheet-handle" />
        <div className="sheet-header">
          <span className="sheet-title">{t("patientAgenda.manageTitle")}</span>
          <button className="sheet-close" aria-label={t("close")} onClick={onClose}>
            <IconX size={14} />
          </button>
        </div>

        <div style={{ padding: "8px 20px 24px" }}>
          {/* Big modality + date hero */}
          <div style={{
            display: "flex", alignItems: "center", gap: 14,
            padding: "16px 14px",
            background: `${modalityColor}10`,
            border: `1px solid ${modalityColor}30`,
            borderRadius: "var(--radius-lg)",
            marginBottom: 16,
          }}>
            <div style={{
              width: 48, height: 48,
              borderRadius: "var(--radius)",
              background: `${modalityColor}25`,
              color: modalityColor,
              display: "flex", alignItems: "center", justifyContent: "center",
              flexShrink: 0,
            }}>
              <ModalityIcon size={22} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                fontFamily: "var(--font-d)", fontWeight: 800, fontSize: 18,
                color: "var(--charcoal)", letterSpacing: "-0.2px",
                marginBottom: 2,
              }}>
                {dateLine}
              </div>
              <div style={{
                fontSize: 14, color: "var(--charcoal-md)",
                fontVariantNumeric: "tabular-nums",
              }}>
                {time}{duration ? ` · ${duration}` : ""}
                {" · "}{modalityLabel}
              </div>
            </div>
          </div>

          {/* If a reschedule request is pending, swap actions: show
              the proposed move + a single "Cancelar solicitud" button.
              The patient can't reschedule again or cancel the session
              while a request is in flight — they have to withdraw
              first or wait for the therapist to respond. */}
          {pending ? (
            <div>
              <div style={{
                background: "var(--amber-bg)",
                border: "1px solid var(--amber)",
                borderRadius: "var(--radius)",
                padding: "12px 14px",
                marginBottom: 14,
                fontSize: 13, color: "var(--charcoal)", lineHeight: 1.5,
              }}>
                <div style={{ fontWeight: 700, marginBottom: 6 }}>
                  {t("patientAgenda.pendingTitle")}
                </div>
                <div style={{ color: "var(--charcoal-md)", fontSize: 12 }}>
                  {t("patientAgenda.pendingDetail", {
                    date: pending.proposed_date,
                    time: pending.proposed_time,
                  })}
                </div>
              </div>
              <button type="button"
                onClick={() => onWithdraw(pending.id)}
                disabled={withdrawing}
                className="btn-tap"
                style={{
                  width: "100%", height: 44,
                  background: "transparent",
                  border: "1px solid var(--red)",
                  borderRadius: "var(--radius-pill)",
                  color: "var(--red)",
                  fontFamily: "inherit", fontWeight: 700, fontSize: 14,
                  cursor: "pointer",
                }}
              >
                {withdrawing ? t("saving") : t("patientAgenda.withdrawCta")}
              </button>
              <button type="button" onClick={onClose} className="btn-tap"
                style={{
                  width: "100%", height: 44, marginTop: 4,
                  background: "transparent", border: "none",
                  color: "var(--charcoal-md)",
                  fontFamily: "inherit", fontWeight: 600, fontSize: 13,
                  cursor: "pointer",
                }}
              >
                {t("close")}
              </button>
            </div>
          ) : session.status === "scheduled" && isFuture ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <button type="button" onClick={() => onReschedule(session)} className="btn-tap"
                style={{
                  height: 44,
                  background: "var(--teal)",
                  border: "none",
                  borderRadius: "var(--radius-pill)",
                  color: "var(--white)",
                  fontFamily: "inherit", fontWeight: 700, fontSize: 14,
                  cursor: "pointer",
                }}
              >
                {t("patientHome.rescheduleCta")}
              </button>
              <button type="button" onClick={() => onCancel(session)} className="btn-tap"
                style={{
                  height: 44,
                  background: "transparent",
                  border: "1px solid var(--red)",
                  borderRadius: "var(--radius-pill)",
                  color: "var(--red)",
                  fontFamily: "inherit", fontWeight: 700, fontSize: 14,
                  cursor: "pointer",
                }}
              >
                {t("patientHome.cancelCta")}
              </button>
              <button type="button" onClick={onClose} className="btn-tap"
                style={{
                  height: 44, marginTop: 4,
                  background: "transparent",
                  border: "none",
                  color: "var(--charcoal-md)",
                  fontFamily: "inherit", fontWeight: 600, fontSize: 13,
                  cursor: "pointer",
                }}
              >
                {t("close")}
              </button>
            </div>
          ) : (
            <div style={{ textAlign: "center", padding: "12px 0" }}>
              <p style={{ fontSize: 13, color: "var(--charcoal-md)", margin: 0, marginBottom: 14 }}>
                {t("patientAgenda.manageReadOnly")}
              </p>
              <button type="button" onClick={onClose} className="btn btn-secondary btn-tap"
                style={{ width: "100%", height: 44 }}
              >
                {t("close")}
              </button>
            </div>
          )}
        </div>
      </div>
    </SheetOverlay>
  );
}

// ── Empty state ─────────────────────────────────────────────────────

function EmptyAgenda({ t }: { t: T }) {
  return (
    <div className="empty-state">
      <div className="empty-state-icon"><IconCalendar size={20} /></div>
      <div className="empty-state-title">{t("patientAgenda.emptyTitle")}</div>
      <div className="empty-state-body">{t("patientAgenda.emptyBody")}</div>
    </div>
  );
}
