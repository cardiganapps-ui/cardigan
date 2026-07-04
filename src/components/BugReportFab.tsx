import { useEffect, useRef, useState } from "react";
import { IconX } from "./Icons";
import { supabase } from "../supabaseClient";
import { getLogs } from "../utils/logBuffer";
import { useT } from "../i18n/index";
import { useEscape } from "../hooks/useEscape";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { useSheetDrag } from "../hooks/useSheetDrag";
import { useSheetExit } from "../hooks/useSheetExit";
import { SheetOverlay } from "./SheetOverlay";

/* ── Bug report sheet ──
   Previously rendered its own floating bottom-left button, which
   crowded the mobile bottom tab bar. The trigger now lives inside the
   drawer menu, so this component just owns the sheet + submission
   state. Open/close is driven by props from App.jsx. */

export function BugReportSheet({ open, onClose, user, screen }: { open?: boolean; onClose?: () => void; user?: { id?: string; email?: string } | null; screen?: string }) {
  const { t } = useT();
  const [description, setDescription] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [submitError, setSubmitError] = useState("");
  // Tracked so the post-success auto-close timer can be cancelled if
  // the user closes the sheet manually within the 1200ms window.
  // Without this, the timer fires onClose() against a closed sheet.
  const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (successTimerRef.current) clearTimeout(successTimerRef.current);
  }, []);
  // Raw close — used by useSheetDrag (which owns its own anim) and
  // as the underlying handler that animatedClose defers to.
  const rawClose = () => {
    if (successTimerRef.current) {
      clearTimeout(successTimerRef.current);
      successTimerRef.current = null;
    }
    setDescription("");
    onClose?.();
  };
  const { exiting, animatedClose } = useSheetExit(!!open, rawClose);
  useEscape(open ? animatedClose : null);
  const panelRef = useFocusTrap(!!open);
  const { scrollRef, setPanelEl, panelHandlers } = useSheetDrag(rawClose, { isOpen: !!open });
  const setPanel = (el: HTMLElement | null) => { panelRef.current = el; scrollRef.current = el; setPanelEl(el); };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSending(true);
    setSubmitError("");
    try {
      const { error } = await supabase.from("bug_reports").insert({
        user_id: user?.id || null,
        user_email: user?.email || null,
        description: description.trim() || null,
        screen,
        logs: getLogs(),
        user_agent: navigator.userAgent,
      });
      if (error) throw error;
      setSent(true);
      successTimerRef.current = setTimeout(() => {
        successTimerRef.current = null;
        setSent(false);
        setDescription("");
        animatedClose();
      }, 1200);
    } catch (err) {
      // Without this, an insert failure (RLS, network, schema mismatch)
      // would leave the button stuck on "Guardando…" forever.
      setSubmitError((err as Error)?.message || t("bugReport.submitFailed"));
    } finally {
      setSending(false);
    }
  };

  if (!open) return null;

  return (
    <SheetOverlay exiting={exiting} onClose={animatedClose}>
      <div ref={setPanel} className={`sheet-panel ${exiting ? "sheet-panel--exit" : ""}`} role="dialog" aria-modal="true" aria-label={t("bugReport.title")} {...panelHandlers}>
        <div className="sheet-handle" />
        <div className="sheet-header">
          <span className="sheet-title">{t("bugReport.title")}</span>
          <button className="sheet-close" aria-label={t("close")} onClick={animatedClose}>
            <IconX size={14} />
          </button>
        </div>
        {sent ? (
          <div style={{ padding: "24px 20px 32px", textAlign: "center", fontSize: 14, fontWeight: 600, color: "var(--teal-dark)" }}>
            {t("bugReport.sent")}
          </div>
        ) : (
          <form onSubmit={submit} style={{ padding: "0 20px 22px" }}>
            <textarea
              className="input"
              rows={4}
              placeholder={t("bugReport.placeholder")}
              value={description}
              onChange={e => setDescription(e.target.value)}
              style={{ resize: "vertical", fontFamily: "var(--font)", fontSize: 13 }}
            />
            {submitError && (
              <div style={{ marginTop: 8, fontSize: 12, color: "var(--red)", lineHeight: 1.4 }}>{submitError}</div>
            )}
            <button className="btn btn-primary-teal" type="submit" disabled={sending}
              style={{ width: "100%", marginTop: 12 }}>
              {sending ? t("saving") : t("bugReport.submit")}
            </button>
          </form>
        )}
      </div>
    </SheetOverlay>
  );
}
