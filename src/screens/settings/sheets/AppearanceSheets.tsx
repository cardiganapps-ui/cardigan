import { useT } from "../../../i18n/index";
import { IconX, IconCheck, IconSun, IconMoon, IconSmartphone } from "../../../components/Icons";
import { SheetOverlay } from "../../../components/SheetOverlay";
import { clickableProps } from "../../../utils/a11y";

/* ── Apariencia (tema) + Color de acento sheets ───────────────────────
   Extracted from Settings.tsx. PRESENTATIONAL: the theme + accent
   preference bags (from CardiganContext) stay in Settings and thread in
   as props. One mode-driven component covers both option-list sheets
   (same shell, same select-and-close behaviour). Shared focus-trap +
   drag wiring threads through setSheetPanel / sheetPanelHandlers. */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any;

export interface AppearanceSheetsProps {
  mode: "theme" | "accent" | null;
  theme: Row;
  accentTheme: Row;
  onClose: () => void;
  setSheetPanel: (el: HTMLDivElement | null) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sheetPanelHandlers: Record<string, any>;
}

const ACCENTS = [
  { key: "default",  swatch: "#1F7A8C" },
  { key: "sage",     swatch: "#88BB99" },
  { key: "amber",    swatch: "#D8B26A" },
  { key: "burgundy", swatch: "#BD8595" },
  { key: "steel",    swatch: "#7A8FA3" },
];

export function AppearanceSheets({ mode, theme, accentTheme, onClose, setSheetPanel, sheetPanelHandlers }: AppearanceSheetsProps) {
  const { t } = useT();
  if (!mode) return null;

  const themeOptions = [
    { key: "light", label: t("settings.themeLight"), icon: <IconSun size={18} /> },
    { key: "dark", label: t("settings.themeDark"), icon: <IconMoon size={18} /> },
    { key: "system", label: t("settings.themeSystem"), icon: <IconSmartphone size={18} /> },
  ];

  return (
        <SheetOverlay onClose={onClose}>
          <div ref={setSheetPanel} className="sheet-panel" role="dialog" aria-modal="true" {...sheetPanelHandlers}>
            <div className="sheet-handle" />
            <div className="sheet-header">
              <span className="sheet-title">{mode === "theme" ? t("settings.appearance") : t("settings.accentColor")}</span>
              <button className="sheet-close" aria-label={t("close")} onClick={onClose}><IconX size={14} /></button>
            </div>
            <div style={{ padding:"0 20px 22px" }}>
              {mode === "theme" ? (
                themeOptions.map(opt => (
                  <div key={opt.key} className="settings-row" style={{ cursor:"pointer" }}
                    {...clickableProps(() => { theme?.setPreference(opt.key); onClose(); })}>
                    <div className="settings-row-icon" style={{ color:"var(--teal-dark)" }}>{opt.icon}</div>
                    <div style={{ flex:1 }}>
                      <div className="settings-row-title">{opt.label}</div>
                    </div>
                    {theme?.preference === opt.key && <IconCheck size={18} style={{ color:"var(--teal)" }} />}
                  </div>
                ))
              ) : (
                ACCENTS.map(opt => (
                  <div key={opt.key} className="settings-row" style={{ cursor:"pointer" }}
                    {...clickableProps(() => { accentTheme?.setAccent(opt.key); onClose(); })}>
                    <div className="settings-row-icon" aria-hidden="true">
                      <span style={{ display:"inline-block", width:18, height:18, borderRadius:"50%", background:opt.swatch, border:"1px solid var(--border-lt)" }} />
                    </div>
                    <div style={{ flex:1 }}>
                      <div className="settings-row-title" style={{ fontWeight:500 }}>{t(`settings.accent.${opt.key}`)}</div>
                    </div>
                    {accentTheme?.accent === opt.key && <IconCheck size={18} style={{ color:"var(--teal)" }} />}
                  </div>
                ))
              )}
            </div>
          </div>
        </SheetOverlay>
  );
}
