import { useState } from "react";
import { IconX } from "../../../components/Icons";
import { useT } from "../../../i18n/index";
import { haptic } from "../../../utils/haptics";
import { createInfluencerCode } from "../../../hooks/useCardiganData";
import { useEscape } from "../../../hooks/useEscape";
import { useFocusTrap } from "../../../hooks/useFocusTrap";
import { useSheetDrag } from "../../../hooks/useSheetDrag";

/* ── NewCodeSheet ──
   Lifted from AdminPanel.jsx (legacy modal). Modal-style sheet for
   creating an influencer / partner discount code. The Codes admin
   page uses this verbatim — no logic changes during the lift. */
export function NewCodeSheet({ onClose, onCreated }) {
  const { t } = useT();
  // A11y + gesture: full canonical sheet wiring — esc dismisses,
  // focus stays trapped, drag-down dismisses. The third hook was
  // missing; without it the sheet had no swipe-away affordance,
  // inconsistent with every other sheet in the app.
  useEscape(onClose);
  useFocusTrap(true);
  const { scrollRef, setPanelEl, panelHandlers } = useSheetDrag(onClose);
  const setPanel = (el) => { scrollRef.current = el; setPanelEl(el); };
  const [code, setCode] = useState("");
  const [influencerName, setInfluencerName] = useState("");
  const [percentOff, setPercentOff] = useState("20");
  const [duration, setDuration] = useState("once");
  const [durationInMonths, setDurationInMonths] = useState("3");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const percentParsed = parseInt(percentOff, 10);
  const monthsParsed = parseInt(durationInMonths, 10);
  const codeValid = /^[A-Z0-9]{4,20}$/.test(code);
  const percentValid = Number.isInteger(percentParsed) && percentParsed >= 1 && percentParsed <= 100;
  const monthsValid = duration !== "repeating"
    || (Number.isInteger(monthsParsed) && monthsParsed >= 1 && monthsParsed <= 12);
  const canSubmit = codeValid && percentValid && monthsValid && !busy;

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setError("");
    try {
      const created = await createInfluencerCode({
        code,
        influencerName: influencerName.trim() || null,
        percentOff: percentParsed,
        duration,
        durationInMonths: duration === "repeating" ? monthsParsed : null,
        notes: notes.trim() || null,
      });
      onCreated(created);
    } catch (e) {
      setError(e.message || t("admin.codesCreateError"));
      setBusy(false);
    }
  };

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
          <span className="sheet-title">{t("admin.codesNewTitle")}</span>
          <button className="sheet-close" aria-label={t("close")} onClick={onClose}>
            <IconX size={14} />
          </button>
        </div>
        <div style={{ padding: "4px 20px 24px" }}>
          <div style={{ fontSize: 13, color: "var(--charcoal-md)", lineHeight: 1.5, marginBottom: 18 }}>
            {t("admin.codesNewSubtitle")}
          </div>

          <div className="input-group">
            <label className="input-label">{t("admin.codesFieldCode")}</label>
            <input
              className="input"
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 20))}
              placeholder="MARIANA20"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              style={{ fontFamily: "var(--font-mono, monospace)", letterSpacing: "0.4px" }}
            />
            <div className="input-help">{t("admin.codesFieldCodeHint")}</div>
          </div>

          <div className="input-group">
            <label className="input-label">{t("admin.codesFieldInfluencer")}</label>
            <input
              className="input"
              type="text"
              value={influencerName}
              onChange={(e) => setInfluencerName(e.target.value.slice(0, 80))}
              placeholder="Mariana Pérez"
            />
            <div className="input-help">{t("admin.codesFieldInfluencerHint")}</div>
          </div>

          <div className="input-group">
            <label className="input-label">{t("admin.codesFieldPercent")}</label>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <input
                className="input"
                type="number"
                inputMode="numeric"
                min={1}
                max={100}
                value={percentOff}
                onChange={(e) => setPercentOff(e.target.value.replace(/[^0-9]/g, "").slice(0, 3))}
                onBlur={() => { if (!percentValid) setPercentOff("20"); }}
                style={{ width: 90, textAlign: "center", fontFamily: "var(--font-mono, monospace)" }}
              />
              <span style={{ fontSize: 14, color: "var(--charcoal-md)" }}>%</span>
            </div>
          </div>

          <div className="input-group">
            <label className="input-label">{t("admin.codesFieldDuration")}</label>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {[
                { k: "once", l: t("admin.codesFieldDurationOnce") },
                { k: "repeating", l: t("admin.codesFieldDurationRepeating") },
                { k: "forever", l: t("admin.codesFieldDurationForever") },
              ].map(opt => {
                const active = duration === opt.k;
                return (
                  <button
                    key={opt.k}
                    type="button"
                    onClick={() => { setDuration(opt.k); haptic.tap(); }}
                    style={{
                      textAlign: "left",
                      padding: "10px 14px",
                      borderRadius: "var(--radius)",
                      border: active ? "2px solid var(--teal)" : "2px solid var(--border-lt)",
                      background: active ? "var(--teal-pale)" : "var(--white)",
                      color: "var(--charcoal)",
                      fontFamily: "inherit",
                      fontSize: 14,
                      fontWeight: active ? 700 : 500,
                      cursor: "pointer",
                      WebkitTapHighlightColor: "transparent",
                    }}
                  >
                    {opt.l}
                  </button>
                );
              })}
            </div>
          </div>

          {duration === "repeating" && (
            <div className="input-group">
              <label className="input-label">{t("admin.codesFieldMonths")}</label>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <input
                  className="input"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={12}
                  value={durationInMonths}
                  onChange={(e) => setDurationInMonths(e.target.value.replace(/[^0-9]/g, "").slice(0, 2))}
                  onBlur={() => { if (!monthsValid) setDurationInMonths("3"); }}
                  style={{ width: 90, textAlign: "center", fontFamily: "var(--font-mono, monospace)" }}
                />
              </div>
            </div>
          )}

          <div className="input-group">
            <label className="input-label">{t("admin.codesFieldNotes")}</label>
            <input
              className="input"
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value.slice(0, 500))}
              placeholder=""
            />
            <div className="input-help">{t("admin.codesFieldNotesHint")}</div>
          </div>

          <div style={{
            background: "var(--cream)",
            color: "var(--charcoal-md)",
            padding: "8px 12px",
            borderRadius: "var(--radius-sm)",
            fontSize: 11,
            lineHeight: 1.4,
            marginBottom: 14,
          }}>
            {t("admin.codesFirstTimeOnly")}
          </div>

          {error && (
            <div style={{ background: "var(--red-bg)", color: "var(--red)", padding: "8px 12px", borderRadius: "var(--radius-sm)", fontSize: 13, marginBottom: 14 }}>
              {error}
            </div>
          )}

          <button
            type="button"
            className="btn btn-primary"
            onClick={submit}
            disabled={!canSubmit}
            style={{ width: "100%" }}
          >
            {busy ? t("admin.codesCreating") : t("admin.codesCreate")}
          </button>
        </div>
      </div>
    </div>
  );
}
