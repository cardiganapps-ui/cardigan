import { useState } from "react";
import { IconBug, IconX } from "./Icons";
import { supabase } from "../supabaseClient";
import { getLogs } from "../utils/logBuffer";
import { useT } from "../i18n/index";
import { useEscape } from "../hooks/useEscape";

export function BugReportFab({ user, screen }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  useEscape(open ? () => { setOpen(false); setDescription(""); } : null);
  const [description, setDescription] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

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
    setTimeout(() => { setSent(false); setOpen(false); setDescription(""); }, 1200);
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label={t("bugReport.title")}
        className="bug-fab"
        style={{
          position: "fixed", left: 16,
          width: 44, height: 44, minHeight: 44, borderRadius: "50%",
          background: "rgba(0,0,0,0.45)", border: "none", padding: 0,
          display: "flex", alignItems: "center", justifyContent: "center",
          color: "var(--white)", cursor: "pointer", zIndex: "var(--z-fab)",
          WebkitTapHighlightColor: "transparent", opacity: 0.7,
        }}
      >
        <IconBug size={18} />
      </button>

      {open && (
        <div className="sheet-overlay" onClick={() => { setOpen(false); setDescription(""); }}>
          <div className="sheet-panel" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()}>
            <div className="sheet-handle" />
            <div className="sheet-header">
              <span className="sheet-title">{t("bugReport.title")}</span>
              <button className="sheet-close" aria-label={t("close")} onClick={() => { setOpen(false); setDescription(""); }}>
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
                <button className="btn btn-primary" type="submit" disabled={sending}
                  style={{ width: "100%", marginTop: 12 }}>
                  {sending ? t("saving") : t("bugReport.submit")}
                </button>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  );
}
