import { IconX, IconSparkle } from "../../../components/Icons";
import { useT } from "../../../i18n/index";
import { CopyChip } from "./CopyChip";
import { useEscape } from "../../../hooks/useEscape";
import { useFocusTrap } from "../../../hooks/useFocusTrap";
import { useSheetDrag } from "../../../hooks/useSheetDrag";

/* ── CodeCreatedSheet ──
   Lifted verbatim from AdminPanel.jsx (legacy modal). Success sheet
   shown immediately after a code is created. Two CopyChips so the
   admin can grab the raw code OR the shareable link, whichever the
   influencer wants. */
export function CodeCreatedSheet({ code, onClose }) {
  const { t } = useT();
  // A11y + gesture: full canonical wiring — esc dismisses, focus
  // stays trapped inside, drag-down dismisses (the third piece this
  // sheet was missing). Without useSheetDrag the user has no swipe-
  // away affordance, inconsistent with every other sheet in the app.
  useEscape(onClose);
  useFocusTrap(true);
  const { scrollRef, setPanelEl, panelHandlers } = useSheetDrag(onClose);
  // Panel is the scroll container, so wire scrollRef + setPanelEl
  // onto the same element (mirrors AvatarPicker's pattern).
  const setPanel = (el) => { scrollRef.current = el; setPanelEl(el); };
  const link = `https://cardigan.mx/c/${code.code}`;
  const durationLabel =
    code.duration === "once" ? t("admin.codesDurationOnce")
    : code.duration === "forever" ? t("admin.codesDurationForever")
    : t("admin.codesDurationRepeating", { months: code.duration_in_months });

  return (
    <div className="sheet-overlay" onClick={onClose}>
      <div
        className="sheet-panel scroll-bounce"
        role="dialog"
        aria-modal="true"
        ref={setPanel}
        {...panelHandlers}
        onClick={e => e.stopPropagation()}
        style={{ maxHeight: "92vh" }}
      >
        <div className="sheet-handle" />
        <div className="sheet-header" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span className="sheet-title">{t("admin.codesCreated")}</span>
          <button className="sheet-close" aria-label={t("close")} onClick={onClose}>
            <IconX size={14} />
          </button>
        </div>
        <div style={{ padding: "8px 20px 24px" }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, padding: "12px 0 18px" }}>
            <div style={{
              width: 54, height: 54, borderRadius: "50%",
              background: "var(--teal-pale)", color: "var(--teal-dark)",
              display: "inline-flex", alignItems: "center", justifyContent: "center",
            }}>
              <IconSparkle size={24} />
            </div>
            <div style={{ textAlign: "center", fontSize: 13, color: "var(--charcoal-md)", lineHeight: 1.5, maxWidth: 320 }}>
              {t("admin.codesCreatedSubtitle")}
            </div>
            <div style={{ fontSize: 13, color: "var(--charcoal-md)" }}>
              {t("admin.codesPercent", { percent: code.percent_off })} · {durationLabel}
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 14 }}>
            <CopyChip text={code.code} label={t("admin.codesFieldCode")} />
            <CopyChip text={link} label={t("admin.codesShareLink")} />
          </div>

          <button
            type="button"
            className="btn btn-secondary"
            onClick={onClose}
            style={{ width: "100%" }}
          >
            {t("admin.codesClose")}
          </button>
        </div>
      </div>
    </div>
  );
}
