import { useT } from "../../../i18n/index";
import { IconX, IconCheck } from "../../../components/Icons";
import { SheetOverlay } from "../../../components/SheetOverlay";

/* ── Editar perfil sheet ──────────────────────────────────────────────
   Extracted from Settings.tsx. PRESENTATIONAL: the edit-name field state,
   the success message, the saving flag, and saveProfile (which writes
   user_metadata) all stay in Settings and thread in as same-name props.
   Shared focus-trap + drag wiring threads through setSheetPanel /
   sheetPanelHandlers. */

export interface ProfileSheetProps {
  open: boolean;
  editName: string;
  setEditName: (v: string) => void;
  userEmail: string;
  message: string;
  saving: boolean;
  saveProfile: () => void | Promise<void>;
  setActiveSheet: (key: string | null) => void;
  setSheetPanel: (el: HTMLDivElement | null) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sheetPanelHandlers: Record<string, any>;
}

export function ProfileSheet({
  open, editName, setEditName, userEmail, message, saving, saveProfile,
  setActiveSheet, setSheetPanel, sheetPanelHandlers,
}: ProfileSheetProps) {
  const { t } = useT();
  if (!open) return null;
  return (
        <SheetOverlay onClose={() => setActiveSheet(null)}>
          <div ref={setSheetPanel} className="sheet-panel" role="dialog" aria-modal="true" {...sheetPanelHandlers}>
            <div className="sheet-handle" />
            <div className="sheet-header">
              <span className="sheet-title">{t("settings.editProfile")}</span>
              <button className="sheet-close" aria-label={t("close")} onClick={() => setActiveSheet(null)}><IconX size={14} /></button>
            </div>
            <div style={{ padding:"0 20px 22px" }}>
              <div className="input-group">
                <label className="input-label">{t("settings.fullName")}</label>
                <input className="input" value={editName} onChange={e => setEditName(e.target.value)} />
              </div>
              <div className="input-group">
                <label className="input-label">{t("settings.email")}</label>
                <input className="input" value={userEmail} disabled style={{ opacity:0.5 }} />
              </div>
              {message && <div style={{ fontSize:12, color:"var(--green)", marginBottom:10, display:"flex", alignItems:"center", gap:4 }}><IconCheck size={14} /> {message}</div>}
              <button className="btn btn-primary-teal" onClick={saveProfile} disabled={saving || !editName.trim()}>
                {saving ? t("saving") : t("save")}
              </button>
            </div>
          </div>
        </SheetOverlay>
  );
}
