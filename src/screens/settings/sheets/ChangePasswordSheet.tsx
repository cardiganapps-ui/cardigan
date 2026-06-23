import { useState, useEffect, useCallback, useRef } from "react";
import { useT } from "../../../i18n/index";
import { IconX } from "../../../components/Icons";
import { supabase } from "../../../supabaseClient";
import { TurnstileWidget, TURNSTILE_ENABLED } from "../../../components/TurnstileWidget";

/* ── Change-password sheet ────────────────────────────────────────────
   Extracted from Settings.tsx. Captcha-gated password-reset email: the
   Turnstile widget is invisible on trusted browsers (interaction-only
   mode); when it surfaces, the user gets a brief challenge before the
   email goes out. The deferred-submit dance (click while the token is
   still resolving → fire the moment it lands) lives entirely here now,
   with its own `saving` flag — Settings no longer owns any of it.

   `setMessage` raises the top-of-Settings success banner; the shared
   focus-trap + drag wiring is threaded through setSheetPanel /
   sheetPanelHandlers like every other Settings sheet. */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any;

export interface ChangePasswordSheetProps {
  open: boolean;
  onClose: () => void;
  userEmail: string;
  setMessage: (msg: string) => void;
  setSheetPanel: (el: HTMLDivElement | null) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sheetPanelHandlers: Record<string, any>;
}

export function ChangePasswordSheet({ open, onClose, userEmail, setMessage, setSheetPanel, sheetPanelHandlers }: ChangePasswordSheetProps) {
  const { t } = useT();
  const [saving, setSaving] = useState(false);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [resetError, setResetError] = useState("");
  const [pendingSubmit, setPendingSubmit] = useState(false);
  const turnstileRef = useRef<Row>(null);

  // Fresh state each time the sheet opens (the Settings onOpenChangePassword
  // handler used to clear these before flipping activeSheet).
  useEffect(() => {
    if (open) { setResetError(""); setCaptchaToken(null); setPendingSubmit(false); }
  }, [open]);

  const resetPassword = useCallback(async (token: string | null) => {
    setSaving(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(userEmail, {
        captchaToken: token || undefined,
      });
      if (error) {
        setResetError(error.message || t("settings.emailError"));
        return;
      }
      setMessage(t("settings.linkSent"));
      onClose();
      setTimeout(() => setMessage(""), 3000);
    } catch {
      setResetError(t("settings.emailError"));
    } finally {
      setSaving(false);
      // Token is single-use; force the widget to issue a fresh one
      // immediately so the next attempt isn't stuck waiting for natural
      // expiry (~5 min in managed mode).
      setCaptchaToken(null);
      setPendingSubmit(false);
      turnstileRef.current?.reset();
    }
  }, [userEmail, t, setMessage, onClose]);

  // Auto-fire submit once the captcha token arrives if the user clicked
  // while the widget was still resolving. Eliminates the visible
  // "Espera a que se complete la verificación" error during cold opens.
  useEffect(() => {
    if (!pendingSubmit) return;
    if (!captchaToken) return;
    if (saving) return;
    resetPassword(captchaToken);
  }, [pendingSubmit, captchaToken, saving, resetPassword]);

  if (!open) return null;

  return (
    <div className="sheet-overlay" onClick={() => !saving && onClose()}>
      <div ref={setSheetPanel} className="sheet-panel" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()} {...sheetPanelHandlers}>
        <div className="sheet-handle" />
        <div className="sheet-header">
          <span className="sheet-title">{t("settings.changePassword")}</span>
          <button className="sheet-close" aria-label={t("close")} onClick={() => !saving && onClose()} disabled={saving}><IconX size={14} /></button>
        </div>
        <div style={{ padding:"0 20px 22px" }}>
          <div style={{ fontSize: 14, color: "var(--charcoal-md)", lineHeight: 1.55, marginBottom: 14 }}>
            {t("settings.changePasswordExplain", { email: userEmail })}
          </div>
          {TURNSTILE_ENABLED && (
            <div style={{ display:"flex", justifyContent:"center", marginBottom: 12 }}>
              <TurnstileWidget ref={turnstileRef} onToken={setCaptchaToken} />
            </div>
          )}
          {resetError && (
            <div style={{ fontSize: 13, color: "var(--red)", marginBottom: 12 }}>{resetError}</div>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <button
              type="button"
              className="btn btn-primary"
              disabled={saving || pendingSubmit}
              onClick={() => {
                if (saving || pendingSubmit) return;
                setResetError("");
                if (TURNSTILE_ENABLED && !captchaToken) {
                  // Captcha hasn't resolved yet — defer; the effect above
                  // fires resetPassword the moment the token arrives.
                  setPendingSubmit(true);
                  return;
                }
                resetPassword(captchaToken);
              }}
            >
              {saving || pendingSubmit ? t("loading") : t("settings.changePasswordCta")}
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => onClose()} disabled={saving}>
              {t("cancel")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
