import { useState, useRef, useEffect } from "react";
import { useT } from "../../../i18n/index";
import { IconX } from "../../../components/Icons";
import { supabase } from "../../../supabaseClient";
import { PasswordInput } from "../../../components/PasswordInput";
import { TurnstileWidget, TURNSTILE_ENABLED } from "../../../components/TurnstileWidget";
import { reauthMessageFor } from "./reauthMessage";

/* ── Export-my-data sheet (ARCO Acceso) ───────────────────────────────
   Extracted from Settings.tsx. Step-up password gate before issuing the
   export — the session JWT alone isn't enough; a stolen token shouldn't
   one-shot the entire data export. Owns its own reauth/captcha state +
   the exportMyData handler. The shared focus-trap + drag wiring threads
   through setSheetPanel / sheetPanelHandlers. */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any;

export interface ExportDataSheetProps {
  open: boolean;
  onClose: () => void;
  showToast: (msg: string, type?: string) => void;
  setSheetPanel: (el: HTMLDivElement | null) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sheetPanelHandlers: Record<string, any>;
}

export function ExportDataSheet({ open, onClose, showToast, setSheetPanel, sheetPanelHandlers }: ExportDataSheetProps) {
  const { t } = useT();
  const [exporting, setExporting] = useState(false);
  const [exportPassword, setExportPassword] = useState("");
  const [exportError, setExportError] = useState("");
  const [exportCaptchaToken, setExportCaptchaToken] = useState<string | null>(null);
  const exportTurnstileRef = useRef<Row>(null);

  // Fresh reauth field + error each open (the DataPrivacyPanel handler
  // used to clear these before flipping activeSheet).
  useEffect(() => {
    if (open) { setExportPassword(""); setExportError(""); }
  }, [open]);

  const exportMyData = async () => {
    if (exporting) return;
    if (!exportPassword) { setExportError(t("settings.privacyReauthRequired")); return; }
    setExporting(true);
    setExportError("");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) { setExportError(t("settings.privacyExportError")); return; }
      const res = await fetch("/api/export-user-data", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          password: exportPassword,
          captchaToken: exportCaptchaToken || undefined,
        }),
      });
      if (!res.ok) {
        // 401 with a code field → reauth issue; surface in the sheet so
        // the user can re-enter without losing the modal context.
        if (res.status === 401) {
          let code = ""; try { const j = await res.json(); code = j.code || ""; } catch { /* ignore */ }
          setExportError(reauthMessageFor(code, t));
          setExportCaptchaToken(null);
          exportTurnstileRef.current?.reset();
          return;
        }
        let msg = t("settings.privacyExportError");
        try { const j = await res.json(); if (j.hint) msg = j.hint; else if (j.error) msg = j.error; } catch { /* keep default */ }
        showToast(msg, res.status === 429 ? "warning" : "error");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const today = new Date().toISOString().slice(0, 10);
      a.download = `cardigan-export-${today}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      showToast(t("settings.privacyExportDone"), "success");
      setExportPassword("");
      onClose();
    } finally {
      setExporting(false);
    }
  };

  if (!open) return null;

  return (
    <div className="sheet-overlay" onClick={() => !exporting && onClose()}>
      <div ref={setSheetPanel} className="sheet-panel" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()} {...sheetPanelHandlers}>
        <div className="sheet-handle" />
        <div className="sheet-header">
          <span className="sheet-title">{t("settings.privacyExport")}</span>
          <button className="sheet-close" aria-label={t("close")} onClick={() => !exporting && onClose()} disabled={exporting}><IconX size={14} /></button>
        </div>
        <div style={{ padding:"0 20px 22px" }}>
          <div style={{ fontSize: 14, color: "var(--charcoal-md)", lineHeight: 1.55, marginBottom: 14 }}>
            {t("settings.privacyExportExplain")}
          </div>
          <div className="input-group" style={{ marginBottom: 14 }}>
            <label className="input-label">{t("settings.privacyReauthLabel")}</label>
            <PasswordInput
              value={exportPassword}
              onChange={(e) => setExportPassword(e.target.value)}
              placeholder={t("settings.privacyReauthPlaceholder")}
              autoComplete="current-password"
              disabled={exporting}
            />
          </div>
          {/* Captcha verification — Supabase Auth has security_captcha_enabled
              on, so signInWithPassword (used by the server-side reauth)
              rejects without a fresh Turnstile token. The widget is
              invisible/managed and resolves on its own; we just hold the
              token and forward it on submit. */}
          {TURNSTILE_ENABLED && (
            <div style={{ display:"flex", justifyContent:"center", marginBottom: 12 }}>
              <TurnstileWidget ref={exportTurnstileRef} onToken={setExportCaptchaToken} />
            </div>
          )}
          {exportError && (
            <div style={{ fontSize: 13, color: "var(--red)", marginBottom: 12 }}>{exportError}</div>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <button
              type="button"
              className="btn btn-primary"
              onClick={exportMyData}
              disabled={exporting || !exportPassword || (TURNSTILE_ENABLED && !exportCaptchaToken)}
            >
              {exporting ? t("loading") : t("settings.privacyExportCta")}
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => onClose()} disabled={exporting}>
              {t("cancel")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
