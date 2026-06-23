import { useState, useEffect } from "react";
import { useT } from "../../../i18n/index";
import { IconX } from "../../../components/Icons";

/* ── MFA sheets (enroll + manage) ─────────────────────────────────────
   Extracted from Settings.tsx. The shared `mfa` instance (useMfa) lives
   in Settings — the Seguridad panel reads its factor list — so it's
   passed in; the sheet-only state (code / busy / error / secret-copied)
   moves here, off the Settings god-component. The shared focus-trap +
   drag wiring is threaded through `setSheetPanel` / `sheetPanelHandlers`
   so a11y behavior is identical to every other Settings sheet.

   `mode` is derived from Settings' activeSheet; null = closed. */

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- mfa is the loosely-typed useMfa() bag
type Row = any;

export interface MfaSheetsProps {
  mode: "enroll" | "manage" | null;
  mfa: Row;
  onClose: () => void;
  showToast: (msg: string, type?: string) => void;
  setSheetPanel: (el: HTMLDivElement | null) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sheetPanelHandlers: Record<string, any>;
}

export function MfaSheets({ mode, mfa, onClose, showToast, setSheetPanel, sheetPanelHandlers }: MfaSheetsProps) {
  const { t } = useT();
  const [mfaCode, setMfaCode] = useState("");
  const [mfaBusy, setMfaBusy] = useState(false);
  const [mfaUiError, setMfaUiError] = useState("");
  const [mfaSecretCopied, setMfaSecretCopied] = useState(false);

  // Fresh state each time a sheet opens, and kick off enrollment when the
  // enroll sheet opens without an in-flight secret. (Previously the
  // Settings onOpenMfa handler did both inline.)
  useEffect(() => {
    if (!mode) return;
    setMfaCode("");
    setMfaUiError("");
    if (mode === "enroll" && !mfa.enrollment) mfa.enroll();
  // Only re-run on a mode transition; mfa is stable enough for this intent.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  const copyMfaSecret = async () => {
    if (!mfa.enrollment?.secret) return;
    try {
      await navigator.clipboard.writeText(mfa.enrollment.secret);
      setMfaSecretCopied(true);
      setTimeout(() => setMfaSecretCopied(false), 1800);
    } catch {
      showToast(t("settings.calendarCopyError"), "error");
    }
  };

  if (mode === "enroll") {
    return (
      <div className="sheet-overlay" onClick={() => { if (!mfaBusy) { mfa.cancelEnroll(); onClose(); } }}>
        <div ref={setSheetPanel} className="sheet-panel" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()} {...sheetPanelHandlers}>
          <div className="sheet-handle" />
          <div className="sheet-header">
            <span className="sheet-title">{t("settings.mfaEnrollTitle")}</span>
            <button className="sheet-close" aria-label={t("close")} onClick={() => { if (!mfaBusy) { mfa.cancelEnroll(); onClose(); } }} disabled={mfaBusy}><IconX size={14} /></button>
          </div>
          <div style={{ padding:"0 20px 22px" }}>
            <div style={{ fontSize: 14, color: "var(--charcoal-md)", lineHeight: 1.55, marginBottom: 14 }}>
              {t("settings.mfaEnrollExplain")}
            </div>
            {!mfa.enrollment && (
              <div style={{ fontSize: 13, color: "var(--charcoal-xl)", marginBottom: 12 }}>{t("loading")}</div>
            )}
            {mfa.enrollment && (
              <>
                {mfa.enrollment.qr && (
                  <div style={{ display:"flex", justifyContent:"center", marginBottom: 14 }}>
                    <img src={mfa.enrollment.qr} alt="MFA QR" width={180} height={180} style={{ background:"var(--white)", padding:8, borderRadius:"var(--radius)" }} />
                  </div>
                )}
                <div style={{ fontSize: 12, color: "var(--charcoal-md)", marginBottom: 6 }}>{t("settings.mfaSecretLabel")}</div>
                <div style={{ background:"var(--teal-pale)", color:"var(--teal-dark)", fontFamily:"var(--font-mono, monospace)", fontSize:12, padding:"10px 12px", borderRadius:"var(--radius)", wordBreak:"break-all", marginBottom: 8, userSelect:"all" }}>
                  {mfa.enrollment.secret}
                </div>
                <button type="button" className="btn btn-ghost" onClick={copyMfaSecret} disabled={mfaBusy}
                  style={{ width:"100%", marginBottom: 14 }}>
                  {mfaSecretCopied ? t("settings.mfaSecretCopied") : t("settings.mfaSecretCopy")}
                </button>
                <div className="input-group" style={{ marginBottom: 12 }}>
                  <label className="input-label">{t("settings.mfaCodeLabel")}</label>
                  <input
                    className="input"
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    pattern="[0-9]{6}"
                    maxLength={6}
                    value={mfaCode}
                    onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                    placeholder="123456"
                    style={{ letterSpacing:"0.4em", textAlign:"center", fontSize:18, fontFamily:"var(--font-mono, monospace)" }}
                    disabled={mfaBusy}
                  />
                </div>
              </>
            )}
            {(mfaUiError || mfa.error) && (
              <div role="alert" aria-live="assertive" style={{ fontSize: 13, color: "var(--red)", marginBottom: 12 }}>{mfaUiError || mfa.error}</div>
            )}
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <button
                type="button"
                className="btn btn-primary"
                disabled={mfaBusy || !mfa.enrollment || mfaCode.length !== 6}
                onClick={async () => {
                  setMfaBusy(true); setMfaUiError("");
                  const ok = await mfa.verifyEnroll(mfaCode);
                  setMfaBusy(false);
                  if (ok) {
                    setMfaCode("");
                    onClose();
                    showToast(t("settings.mfaEnrolled"), "success");
                  } else {
                    setMfaUiError(t("settings.mfaCodeWrong"));
                  }
                }}
              >
                {mfaBusy ? t("loading") : t("settings.mfaVerify")}
              </button>
              <button type="button" className="btn btn-ghost" disabled={mfaBusy}
                onClick={() => { mfa.cancelEnroll(); onClose(); }}>
                {t("cancel")}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (mode === "manage") {
    // Unenroll target is always the (single) active factor — captured at
    // open time before, now read straight off the shared instance.
    const unenrollId = mfa.factors?.[0]?.id;
    return (
      <div className="sheet-overlay" onClick={() => !mfaBusy && onClose()}>
        <div ref={setSheetPanel} className="sheet-panel" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()} {...sheetPanelHandlers}>
          <div className="sheet-handle" />
          <div className="sheet-header">
            <span className="sheet-title">{t("settings.mfaTitle")}</span>
            <button className="sheet-close" aria-label={t("close")} onClick={() => !mfaBusy && onClose()} disabled={mfaBusy}><IconX size={14} /></button>
          </div>
          <div style={{ padding:"0 20px 22px" }}>
            <div style={{ fontSize: 14, color: "var(--charcoal-md)", lineHeight: 1.55, marginBottom: 14 }}>
              {t("settings.mfaManageActive")}
            </div>
            <div style={{ background:"var(--red-bg, #fdecea)", color:"var(--red-dark, #922)", padding:"10px 12px", borderRadius:"var(--radius)", fontSize:13, lineHeight:1.5, marginBottom: 16 }}>
              {t("settings.mfaUnenrollWarn")}
            </div>
            {(mfaUiError || mfa.error) && (
              <div role="alert" aria-live="assertive" style={{ fontSize: 13, color: "var(--red)", marginBottom: 12 }}>{mfaUiError || mfa.error}</div>
            )}
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <button
                type="button"
                className="btn btn-primary"
                style={{ background:"var(--red)", color:"var(--white)" }}
                disabled={mfaBusy || !unenrollId}
                onClick={async () => {
                  if (!unenrollId) return;
                  setMfaBusy(true); setMfaUiError("");
                  const ok = await mfa.unenroll(unenrollId);
                  setMfaBusy(false);
                  if (ok) {
                    onClose();
                    showToast(t("settings.mfaUnenrolled"), "info");
                  } else {
                    setMfaUiError(t("settings.mfaUnenrollError"));
                  }
                }}
              >
                {mfaBusy ? t("loading") : t("settings.mfaUnenroll")}
              </button>
              <button type="button" className="btn btn-ghost" disabled={mfaBusy} onClick={() => onClose()}>
                {t("cancel")}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return null;
}
