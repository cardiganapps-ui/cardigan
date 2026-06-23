import { useState, useEffect } from "react";
import { useT } from "../../../i18n/index";
import { IconX, IconLock, IconCheck } from "../../../components/Icons";
import { PasswordInput } from "../../../components/PasswordInput";

/* ── Note-encryption sheets (setup / change / disable) ────────────────
   Extracted from Settings.tsx. The shared noteCrypto bag lives in context
   (the Seguridad panel reads its status for the summary row) and is passed
   in; all the passphrase/confirm/busy/error state + the three submit
   handlers move here. The main "encryption" sheet branches on
   noteCrypto.status (disabled → set up, locked → hint, unlocked → manage
   with links to change / disable). `onNavigate` routes the unlocked-sheet
   buttons to the sibling sheets; shared focus-trap + drag wiring threads
   through setSheetPanel / sheetPanelHandlers. */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any;

export interface EncryptionSheetsProps {
  mode: "main" | "change" | "disable" | null;
  onClose: () => void;
  onNavigate: (mode: "change" | "disable") => void;
  noteCrypto: Row;
  showToast: (msg: string, type?: string) => void;
  setSheetPanel: (el: HTMLDivElement | null) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sheetPanelHandlers: Record<string, any>;
}

export function EncryptionSheets({ mode, onClose, onNavigate, noteCrypto, showToast, setSheetPanel, sheetPanelHandlers }: EncryptionSheetsProps) {
  const { t } = useT();
  const [encSetupPass1, setEncSetupPass1] = useState("");
  const [encSetupPass2, setEncSetupPass2] = useState("");
  const [encChangeNew1, setEncChangeNew1] = useState("");
  const [encChangeNew2, setEncChangeNew2] = useState("");
  const [encConfirmDisable, setEncConfirmDisable] = useState("");
  const [encBusy, setEncBusy] = useState(false);
  const [encUiError, setEncUiError] = useState("");

  // Fresh fields + error whenever a sheet opens (the Settings
  // onOpenEncryption handler + the unlocked-sheet nav buttons used to
  // clear these before flipping activeSheet).
  useEffect(() => {
    if (!mode) return;
    // Reset-on-open sync with the mode lifecycle (legitimate; mirrors the
    // other Settings sheets). The rule targets accidental cascading
    // renders, not deliberate field resets on a prop transition.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEncUiError("");
    if (mode === "main") { setEncSetupPass1(""); setEncSetupPass2(""); }
    else if (mode === "change") { setEncChangeNew1(""); setEncChangeNew2(""); }
    else if (mode === "disable") { setEncConfirmDisable(""); }
  }, [mode]);

  const submitEncryptionSetup = async () => {
    setEncUiError("");
    if (encSetupPass1.length < 8) { setEncUiError(t("settings.encMinLength")); return; }
    if (encSetupPass1 !== encSetupPass2) { setEncUiError(t("settings.encMismatch")); return; }
    setEncBusy(true);
    const ok = await noteCrypto?.setup(encSetupPass1);
    setEncBusy(false);
    if (ok) {
      setEncSetupPass1(""); setEncSetupPass2(""); onClose();
      showToast(t("settings.encEnabledToast"), "success");
    } else if (noteCrypto?.error) {
      setEncUiError(noteCrypto.error);
    }
  };

  const submitEncryptionChange = async () => {
    setEncUiError("");
    if (encChangeNew1.length < 8) { setEncUiError(t("settings.encMinLength")); return; }
    if (encChangeNew1 !== encChangeNew2) { setEncUiError(t("settings.encMismatch")); return; }
    setEncBusy(true);
    const ok = await noteCrypto?.changePassphrase(encChangeNew1);
    setEncBusy(false);
    if (ok) {
      setEncChangeNew1(""); setEncChangeNew2(""); onClose();
      showToast(t("settings.encChangedToast"), "success");
    } else if (noteCrypto?.error) {
      setEncUiError(noteCrypto.error);
    }
  };

  const submitEncryptionDisable = async () => {
    setEncUiError("");
    if (encConfirmDisable !== "DESCIFRAR") { setEncUiError(t("settings.encDisableConfirmRequired")); return; }
    setEncBusy(true);
    const ok = await noteCrypto?.disable();
    setEncBusy(false);
    if (ok) {
      setEncConfirmDisable(""); onClose();
      showToast(t("settings.encDisabledToast"), "info");
    } else if (noteCrypto?.error) {
      setEncUiError(noteCrypto.error);
    }
  };

  if (mode === "main") {
    return (
      <div className="sheet-overlay" onClick={() => !encBusy && onClose()}>
        <div ref={setSheetPanel} className="sheet-panel" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()} {...sheetPanelHandlers}>
          <div className="sheet-handle" />
          <div className="sheet-header">
            <span className="sheet-title">{t("settings.encryptionTitle")}</span>
            <button className="sheet-close" aria-label={t("close")} onClick={() => !encBusy && onClose()} disabled={encBusy}><IconX size={14} /></button>
          </div>
          <div style={{ padding:"0 20px 22px" }}>
            {noteCrypto?.status === "disabled" && (
              <>
                <div style={{ fontSize: 14, color: "var(--charcoal-md)", lineHeight: 1.55, marginBottom: 14 }}>
                  {t("settings.encSetupExplain")}
                </div>
                <div className="input-group" style={{ marginBottom: 12 }}>
                  <label className="input-label">{t("settings.encNewPassphrase")}</label>
                  <PasswordInput autoComplete="new-password" value={encSetupPass1} onChange={(e) => setEncSetupPass1(e.target.value)} disabled={encBusy} />
                </div>
                <div className="input-group" style={{ marginBottom: 14 }}>
                  <label className="input-label">{t("settings.encConfirmPassphrase")}</label>
                  <PasswordInput autoComplete="new-password" value={encSetupPass2} onChange={(e) => setEncSetupPass2(e.target.value)} disabled={encBusy} />
                </div>
                {encUiError && <div role="alert" aria-live="assertive" style={{ fontSize: 13, color: "var(--red)", marginBottom: 12 }}>{encUiError}</div>}
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <button type="button" className="btn btn-primary" onClick={submitEncryptionSetup} disabled={encBusy || encSetupPass1.length < 8}>
                    {encBusy ? t("loading") : t("settings.encEnableCta")}
                  </button>
                  <button type="button" className="btn btn-ghost" onClick={() => onClose()} disabled={encBusy}>
                    {t("cancel")}
                  </button>
                </div>
              </>
            )}
            {noteCrypto?.status === "locked" && (
              <>
                <div style={{ display:"flex", alignItems:"center", gap:10, padding:"12px 14px", background:"var(--cream)", borderRadius:"var(--radius)", marginBottom:14 }}>
                  <div style={{ color:"var(--charcoal-md)" }}><IconLock size={18} /></div>
                  <div style={{ fontSize:13, color:"var(--charcoal)", fontWeight:600 }}>{t("settings.encStatusLocked")}</div>
                </div>
                <div style={{ fontSize:13, color:"var(--charcoal-md)", lineHeight:1.55 }}>
                  {t("settings.encLockedHint")}
                </div>
              </>
            )}
            {noteCrypto?.status === "unlocked" && (
              <>
                <div style={{ display:"flex", alignItems:"center", gap:10, padding:"12px 14px", background:"var(--green-bg)", borderRadius:"var(--radius)", marginBottom:14 }}>
                  <div style={{ color:"var(--green)" }}><IconCheck size={18} /></div>
                  <div style={{ fontSize:13, color:"var(--charcoal)", fontWeight:600 }}>{t("settings.encStatusUnlocked")}</div>
                </div>
                <div style={{ fontSize:14, color:"var(--charcoal-md)", lineHeight:1.55, marginBottom:14 }}>
                  {t("settings.encryptionUnlockedExplain")}
                </div>
                <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                  <button type="button" className="btn btn-ghost" onClick={() => onNavigate("change")}>
                    {t("settings.encChange")}
                  </button>
                  <button type="button" className="btn btn-ghost"
                    style={{ color:"var(--red)", borderColor:"var(--red)" }}
                    onClick={() => onNavigate("disable")}>
                    {t("settings.encDisable")}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (mode === "change") {
    return (
      <div className="sheet-overlay" onClick={() => !encBusy && onClose()}>
        <div ref={setSheetPanel} className="sheet-panel" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()} {...sheetPanelHandlers}>
          <div className="sheet-handle" />
          <div className="sheet-header">
            <span className="sheet-title">{t("settings.encChange")}</span>
            <button className="sheet-close" aria-label={t("close")} onClick={() => !encBusy && onClose()} disabled={encBusy}><IconX size={14} /></button>
          </div>
          <div style={{ padding:"0 20px 22px" }}>
            <div className="input-group" style={{ marginBottom: 12 }}>
              <label className="input-label">{t("settings.encNewPassphrase")}</label>
              <PasswordInput autoComplete="new-password" value={encChangeNew1} onChange={(e) => setEncChangeNew1(e.target.value)} disabled={encBusy} />
            </div>
            <div className="input-group" style={{ marginBottom: 14 }}>
              <label className="input-label">{t("settings.encConfirmPassphrase")}</label>
              <PasswordInput autoComplete="new-password" value={encChangeNew2} onChange={(e) => setEncChangeNew2(e.target.value)} disabled={encBusy} />
            </div>
            {encUiError && <div style={{ fontSize: 13, color: "var(--red)", marginBottom: 12 }}>{encUiError}</div>}
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <button type="button" className="btn btn-primary" onClick={submitEncryptionChange} disabled={encBusy || encChangeNew1.length < 8}>
                {encBusy ? t("loading") : t("settings.encChangeCta")}
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => onClose()} disabled={encBusy}>
                {t("cancel")}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (mode === "disable") {
    return (
      <div className="sheet-overlay" onClick={() => !encBusy && onClose()}>
        <div ref={setSheetPanel} className="sheet-panel" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()} {...sheetPanelHandlers}>
          <div className="sheet-handle" />
          <div className="sheet-header">
            <span className="sheet-title">{t("settings.encDisable")}</span>
            <button className="sheet-close" aria-label={t("close")} onClick={() => !encBusy && onClose()} disabled={encBusy}><IconX size={14} /></button>
          </div>
          <div style={{ padding:"0 20px 22px" }}>
            <div style={{ background: "var(--red-pale, #fdecea)", color: "var(--red-dark, #922)", padding: "10px 14px", borderRadius: "var(--radius)", fontSize: 13, lineHeight: 1.5, marginBottom: 14 }}>
              {t("settings.encDisableWarning")}
            </div>
            <div className="input-group" style={{ marginBottom: 14 }}>
              <label className="input-label">{t("settings.encDisableConfirmLabel")}</label>
              <input
                className="input"
                type="text"
                autoComplete="off"
                autoCapitalize="characters"
                value={encConfirmDisable}
                onChange={(e) => setEncConfirmDisable(e.target.value)}
                placeholder="DESCIFRAR"
                disabled={encBusy}
              />
            </div>
            {encUiError && <div style={{ fontSize: 13, color: "var(--red)", marginBottom: 12 }}>{encUiError}</div>}
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <button
                type="button"
                className="btn btn-primary"
                onClick={submitEncryptionDisable}
                disabled={encBusy || encConfirmDisable !== "DESCIFRAR"}
                style={{ background: "var(--red)", color: "var(--white)" }}
              >
                {encBusy ? t("loading") : t("settings.encDisableCta")}
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => onClose()} disabled={encBusy}>
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
