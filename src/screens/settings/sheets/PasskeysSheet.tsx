import { useState } from "react";
import { useT } from "../../../i18n/index";
import { IconX, IconKey } from "../../../components/Icons";
import { ConfirmDialog } from "../../../components/ConfirmDialog";

/* ── Passkeys sheet ───────────────────────────────────────────────────
   Extracted from Settings.tsx. Lists the user's WebAuthn passkeys and
   lets them add or remove one; register()/remove() each trigger the
   platform's own passkey UI (Face ID / Touch ID) via the hook, so
   there's no code to enter. The shared usePasskeys() instance lives in
   Settings (the Seguridad panel reads its count) and is passed in; the
   remove-confirm dialog + its `passkeyRemoveId` state move here. Shared
   focus-trap + drag wiring threads through setSheetPanel /
   sheetPanelHandlers like every other Settings sheet. */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any;

export interface PasskeysSheetProps {
  open: boolean;
  onClose: () => void;
  passkeys: Row;
  showToast: (msg: string, type?: string) => void;
  setSheetPanel: (el: HTMLDivElement | null) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sheetPanelHandlers: Record<string, any>;
}

export function PasskeysSheet({ open, onClose, passkeys, showToast, setSheetPanel, sheetPanelHandlers }: PasskeysSheetProps) {
  const { t } = useT();
  const [passkeyRemoveId, setPasskeyRemoveId] = useState<string | null>(null);

  return (
    <>
      {open && (
        <div className="sheet-overlay" onClick={() => !passkeys.busy && onClose()}>
          <div ref={setSheetPanel} className="sheet-panel" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()} {...sheetPanelHandlers}>
            <div className="sheet-handle" />
            <div className="sheet-header">
              <span className="sheet-title">{t("settings.passkeySheetTitle")}</span>
              <button className="sheet-close" aria-label={t("close")} onClick={() => !passkeys.busy && onClose()} disabled={passkeys.busy}><IconX size={14} /></button>
            </div>
            <div style={{ padding:"0 20px 22px" }}>
              <div style={{ fontSize: 14, color: "var(--charcoal-md)", lineHeight: 1.55, marginBottom: 16 }}>
                {t("settings.passkeySheetIntro")}
              </div>
              {passkeys.error && (
                <div role="alert" aria-live="assertive" style={{ fontSize: 13, color: "var(--red)", marginBottom: 12 }}>{passkeys.error}</div>
              )}
              {passkeys.loading ? (
                <div style={{ fontSize: 13, color: "var(--charcoal-xl)", padding: "8px 0 16px" }}>…</div>
              ) : passkeys.passkeys.length === 0 ? (
                <div style={{ fontSize: 13, color: "var(--charcoal-xl)", lineHeight: 1.5, padding: "4px 0 16px" }}>
                  {t("settings.passkeyEmpty")}
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
                  {passkeys.passkeys.map((pk: Row) => (
                    <div key={pk.id} style={{ display:"flex", alignItems:"center", gap:12, padding:"12px 14px", border:"1px solid var(--border-lt)", borderRadius:"var(--radius)" }}>
                      <div style={{ color:"var(--teal-dark)", display:"inline-flex", flexShrink:0 }}><IconKey size={18} /></div>
                      <div style={{ flex:1, minWidth:0 }}>
                        <div style={{ fontFamily:"var(--font-d)", fontWeight:700, fontSize:14, color:"var(--charcoal)", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>
                          {pk.friendly_name || t("settings.passkeyTitle")}
                        </div>
                        {pk.created_at && (
                          <div style={{ fontSize:12, color:"var(--charcoal-xl)" }}>
                            {t("settings.passkeyCreatedOn", { date: new Date(pk.created_at).toLocaleDateString("es-MX", { day:"numeric", month:"short", year:"numeric" }) })}
                          </div>
                        )}
                      </div>
                      <button
                        type="button"
                        className="btn-tap"
                        disabled={passkeys.busy}
                        onClick={() => setPasskeyRemoveId(pk.id)}
                        style={{ background:"transparent", border:"none", color:"var(--red)", fontSize:13, fontWeight:700, fontFamily:"var(--font)", padding:"6px 8px", cursor:"pointer", flexShrink:0 }}
                      >
                        {t("settings.passkeyRemove")}
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <button
                  type="button"
                  className="btn btn-primary-teal"
                  disabled={passkeys.busy}
                  onClick={async () => {
                    const ok = await passkeys.register();
                    if (ok) showToast(t("settings.passkeyPromptDone"), "success");
                    else if (passkeys.error) showToast(t("settings.passkeyAddError"), "error");
                  }}
                >
                  {passkeys.busy ? t("settings.passkeyAdding") : t("settings.passkeyAdd")}
                </button>
                <button type="button" className="btn btn-ghost" disabled={passkeys.busy} onClick={() => onClose()}>
                  {t("close")}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!passkeyRemoveId}
        title={t("settings.passkeyRemoveConfirmTitle")}
        body={t("settings.passkeyRemoveConfirmBody")}
        confirmLabel={t("settings.passkeyRemove")}
        destructive
        onConfirm={async () => {
          const id = passkeyRemoveId!;
          setPasskeyRemoveId(null);
          await passkeys.remove(id);
        }}
        onCancel={() => setPasskeyRemoveId(null)}
      />
    </>
  );
}
