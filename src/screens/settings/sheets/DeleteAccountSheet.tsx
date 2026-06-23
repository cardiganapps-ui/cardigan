import { useState, useRef, useEffect } from "react";
import { useT } from "../../../i18n/index";
import { IconX } from "../../../components/Icons";
import { supabase } from "../../../supabaseClient";
import { PasswordInput } from "../../../components/PasswordInput";
import { TurnstileWidget, TURNSTILE_ENABLED } from "../../../components/TurnstileWidget";
import { reauthMessageFor } from "./reauthMessage";

/* ── Delete-account sheet (ARCO Cancelación) ──────────────────────────
   Extracted from Settings.tsx. Type-to-confirm ("ELIMINAR") + step-up
   password + captcha before the cascade delete. Owns its own confirm /
   reauth / captcha state + the confirmDeleteAccount handler; on success
   it signs the (now-orphan) session out. Shared focus-trap + drag wiring
   threads through setSheetPanel / sheetPanelHandlers. */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any;

export interface DeleteAccountSheetProps {
  open: boolean;
  onClose: () => void;
  signOut: (scope?: string) => void | Promise<void>;
  setSheetPanel: (el: HTMLDivElement | null) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sheetPanelHandlers: Record<string, any>;
}

export function DeleteAccountSheet({ open, onClose, signOut, setSheetPanel, sheetPanelHandlers }: DeleteAccountSheetProps) {
  const { t } = useT();
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [deletePassword, setDeletePassword] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [deleteCaptchaToken, setDeleteCaptchaToken] = useState<string | null>(null);
  const deleteTurnstileRef = useRef<Row>(null);

  // Fresh confirm field + error each open (the DangerZone handler used to
  // clear these before flipping activeSheet).
  useEffect(() => {
    if (open) { setDeleteConfirm(""); setDeleteError(""); }
  }, [open]);

  const confirmDeleteAccount = async () => {
    if (deleting) return;
    if (!deletePassword) { setDeleteError(t("settings.privacyReauthRequired")); return; }
    setDeleting(true);
    setDeleteError("");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) { setDeleteError(t("settings.privacyDeleteError")); return; }
      // Normalize the confirmation phrase: iOS predictive keyboards
      // can insert trailing spaces or lowercase characters even with
      // autoCapitalize="characters". The server still requires exact
      // "ELIMINAR" so we send the normalized value.
      const normalizedConfirmation = deleteConfirm.trim().toUpperCase();
      const res = await fetch("/api/delete-my-account", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          confirmation: normalizedConfirmation,
          password: deletePassword,
          captchaToken: deleteCaptchaToken || undefined,
        }),
      });
      if (!res.ok) {
        // 401 → reauth issue; keep the sheet open so the user can fix.
        if (res.status === 401) {
          let code = ""; try { const j = await res.json(); code = j.code || ""; } catch { /* ignore */ }
          setDeleteError(reauthMessageFor(code, t));
          // Captcha tokens are single-use; force a fresh challenge so a
          // retry isn't immediately blocked by the same stale token.
          setDeleteCaptchaToken(null);
          deleteTurnstileRef.current?.reset();
          return;
        }
        let msg = t("settings.privacyDeleteError");
        try { const j = await res.json(); if (j.error) msg = j.error; } catch { /* keep default */ }
        setDeleteError(msg);
        return;
      }
      // Cascade completed — sign out to clear the (now-orphan) session.
      await signOut();
    } catch (err) {
      // Surface network / unexpected errors so the user knows something
      // happened (a silent failure looks like the button is broken).
      setDeleteError((err as Error)?.message || t("settings.privacyDeleteError"));
    } finally {
      setDeleting(false);
    }
  };

  if (!open) return null;

  return (
    <div className="sheet-overlay" onClick={() => !deleting && onClose()}>
      <div ref={setSheetPanel} className="sheet-panel" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()} {...sheetPanelHandlers}>
        <div className="sheet-handle" />
        <div className="sheet-header">
          <span className="sheet-title">{t("settings.privacyDelete")}</span>
          <button className="sheet-close" aria-label={t("close")} onClick={() => !deleting && onClose()} disabled={deleting}><IconX size={14} /></button>
        </div>
        <div style={{ padding:"0 20px 22px" }}>
          <div style={{ fontSize: 14, color: "var(--charcoal-md)", lineHeight: 1.55, marginBottom: 14 }}>
            {t("settings.privacyDeleteExplain")}
          </div>
          <div style={{ background: "var(--red-pale, #fdecea)", color: "var(--red-dark, #922)", padding: "10px 14px", borderRadius: "var(--radius)", fontSize: 13, lineHeight: 1.5, marginBottom: 16 }}>
            {t("settings.privacyDeleteWarning")}
          </div>
          {/* iOS Safari autofills the closest text field above any
              password input as the "username" side of a sign-in
              pair. To stop it from dumping the user's email into
              the confirmation field, we plant a hidden username
              input here that absorbs the pairing instead. The
              attributes also dissuade 1Password / LastPass / iOS
              Keychain. */}
          <input
            type="text"
            name="absorb-username-autofill"
            autoComplete="username"
            tabIndex={-1}
            aria-hidden="true"
            style={{
              position: "absolute",
              width: 1, height: 1,
              opacity: 0, pointerEvents: "none",
              border: 0, padding: 0, margin: -1,
              overflow: "hidden", clip: "rect(0 0 0 0)",
            }}
            value=""
            readOnly
          />
          <div className="input-group" style={{ marginBottom: 14 }}>
            <label className="input-label">{t("settings.privacyDeleteConfirmLabel")}</label>
            <input
              className="input"
              type="text"
              inputMode="text"
              // Distinct, non-standard name so password managers
              // don't try to autofill known credentials here.
              name="cardigan-eliminar-confirm"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              autoCapitalize="characters"
              data-1p-ignore
              data-lpignore="true"
              value={deleteConfirm}
              onChange={(e) => setDeleteConfirm(e.target.value)}
              placeholder="ELIMINAR"
              disabled={deleting}
            />
            {/* Inline hint when the value is non-empty but doesn't
                match. The user almost always lands here because of
                iOS autofill — a "Borrar" button gives them a
                one-tap recovery instead of having to manually
                delete their email character by character. */}
            {deleteConfirm
              && deleteConfirm.trim().toUpperCase() !== "ELIMINAR" && (
              <div style={{
                display:"flex", alignItems:"center", justifyContent:"space-between",
                gap:8, marginTop:6, fontSize:12, color:"var(--charcoal-md)",
                lineHeight:1.45,
              }}>
                <span>{t("settings.privacyDeleteHint")}</span>
                <button
                  type="button"
                  onClick={() => setDeleteConfirm("")}
                  style={{
                    background:"none", border:"none", color:"var(--teal-dark)",
                    fontWeight:700, fontSize:12, cursor:"pointer", padding:"2px 6px",
                  }}
                >
                  {t("settings.privacyDeleteClear")}
                </button>
              </div>
            )}
          </div>
          <div className="input-group" style={{ marginBottom: 14 }}>
            <label className="input-label">{t("settings.privacyReauthLabel")}</label>
            <PasswordInput
              value={deletePassword}
              onChange={(e) => setDeletePassword(e.target.value)}
              placeholder={t("settings.privacyReauthPlaceholder")}
              autoComplete="current-password"
              disabled={deleting}
            />
          </div>
          {/* Captcha verification — see export sheet for context. */}
          {TURNSTILE_ENABLED && (
            <div style={{ display:"flex", justifyContent:"center", marginBottom: 12 }}>
              <TurnstileWidget ref={deleteTurnstileRef} onToken={setDeleteCaptchaToken} />
            </div>
          )}
          {deleteError && (
            <div role="alert" aria-live="assertive" style={{ fontSize: 13, color: "var(--red)", marginBottom: 12 }}>{deleteError}</div>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <button
              type="button"
              className="btn btn-primary"
              onClick={confirmDeleteAccount}
              disabled={deleting
                || deleteConfirm.trim().toUpperCase() !== "ELIMINAR"
                || !deletePassword
                || (TURNSTILE_ENABLED && !deleteCaptchaToken)}
              style={{ background: "var(--red)", color: "var(--white)" }}
            >
              {deleting ? t("loading") : t("settings.privacyDeleteCta")}
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => onClose()} disabled={deleting}>
              {t("cancel")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
