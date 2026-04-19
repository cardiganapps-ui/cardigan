import { useState } from "react";
import { IconX } from "./Icons";
import { supabase } from "../supabaseClient";
import { getLogs } from "../utils/logBuffer";
import { useT } from "../i18n/index";
import { useEscape } from "../hooks/useEscape";
import { useSheetDrag } from "../hooks/useSheetDrag";

/* ── Bug report sheet ──
   Previously rendered its own floating bottom-left button, which
   crowded the mobile bottom tab bar. The trigger now lives inside the
   drawer menu, so this component just owns the sheet + submission
   state. Open/close is driven by props from App.jsx. */

export function BugReportSheet({ open, onClose, user, screen }) {
  const { t } = useT();
  const [description, setDescription] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const closeSheet = () => { setDescription(""); onClose?.(); };
  useEscape(open ? closeSheet : null);
  const { scrollRef, setPanelEl, panelHandlers } = useSheetDrag(closeSheet, { isOpen: open });
  const setPanel = (el) => { scrollRef.current = el; setPanelEl(el); };

  const submit = async (e) => {
    e.preventDefault();
    setSending(true);
    await supabase.from("bug_reports").insert({
      user_id: user?.id || null,
      user_email: user?.email || null,
      description: description.trim() || null,
      screen,
      logs: getLogs(),
      user_agent: navigator.userAgent,
    });
    setSending(false);
    setSent(true);
    setTimeout(() => { setSent(false); setDescription(""); onClose?.(); }, 1200);
  };

  if (!open) return null;

  return (
    <div className="sheet-overlay" onClick={closeSheet}>
      <div ref={setPanel} className="sheet-panel" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()} {...panelHandlers}>
        <div className="sheet-handle" />
        <div className="sheet-header">
          <span className="sheet-title">{t("bugReport.title")}</span>
          <button className="sheet-close" aria-label={t("close")} onClick={closeSheet}>
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
            <button className="btn btn-primary-teal" type="submit" disabled={sending}
              style={{ width: "100%", marginTop: 12 }}>
              {sending ? t("saving") : t("bugReport.submit")}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
