import { useEffect, useRef, useState } from "react";
import { useT } from "../i18n/index";
import { LogoIcon } from "../components/LogoMark";
import { IconCheck } from "../components/Icons";
import { SIGNUP_SOURCE, SIGNUP_SOURCES, SIGNUP_SOURCE_DETAIL_MAX_LEN } from "../data/constants";
import { haptic } from "../utils/haptics";

/* ── SignupSourceStep ──
   Step 2 of the post-signup onboarding wizard. Shown right after the
   profession picker. Eight predefined channels + "Otro" with a 60-char
   text input. Required — submit is disabled until a tile is selected
   and (if "Otro") the detail field has a non-empty trimmed value.

   Reuses the .profession-onboarding-* CSS so visual rhythm stays
   identical between the two wizard steps. Tiles are label-only here
   (no description) so 8 tiles fit a screen comfortably. */
export function SignupSourceStep({ onSubmit, onSignOut }) {
  const { t } = useT();
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const detailRef = useRef(null);

  const isOther = selected === SIGNUP_SOURCE.OTHER;
  const detailValid = !isOther || detail.trim().length > 0;
  const canSubmit = !!selected && detailValid && !saving;

  // Auto-focus the detail input when "Otro" is freshly picked so the
  // user doesn't have to hunt for the cursor. Skip on subsequent
  // toggles back to "Otro" if the input already has content.
  useEffect(() => {
    if (isOther && detail.length === 0 && detailRef.current) {
      // requestAnimationFrame so the input has finished its mount
      // animation before we steal focus (avoids iOS keyboard popping
      // mid-transition).
      const id = requestAnimationFrame(() => detailRef.current?.focus());
      return () => cancelAnimationFrame(id);
    }
  }, [isOther, detail.length]);

  const submit = async () => {
    if (!canSubmit) {
      if (!selected) setErr(t("onboarding.sourceRequired"));
      else if (!detailValid) setErr(t("onboarding.sourceOtherRequired"));
      return;
    }
    setSaving(true);
    setErr("");
    const ok = await onSubmit({
      signupSource: selected,
      signupSourceDetail: isOther ? detail.trim() : null,
    });
    if (!ok) {
      setSaving(false);
      setErr(t("onboarding.error"));
    }
    // Success → parent unmounts the gate.
  };

  return (
    <div className="shell profession-onboarding">
      <div className="profession-onboarding-inner">
        <div className="profession-onboarding-brand" style={{ "--rise-i": 0 }}>
          <LogoIcon size={22} color="var(--teal)" />
          <span className="profession-onboarding-brand-text">cardigan</span>
        </div>

        <div style={{ "--rise-i": 1 }} className="profession-onboarding-headline">
          <div className="profession-onboarding-title">
            {t("onboarding.sourceTitle")}
          </div>
          <div className="profession-onboarding-subtitle">
            {t("onboarding.sourceSubtitle")}
          </div>
        </div>

        <div className="profession-onboarding-tiles">
          {SIGNUP_SOURCES.map((s, i) => {
            const active = selected === s;
            return (
              <button
                key={s}
                type="button"
                className={`profession-onboarding-tile ${active ? "profession-onboarding-tile--active" : ""}`}
                style={{ "--rise-i": 2 + i, padding: "12px 16px" }}
                onClick={() => { setSelected(s); setErr(""); haptic.tap(); }}
                disabled={saving}
                aria-pressed={active}
              >
                <div className="profession-onboarding-tile-content">
                  <div className="profession-onboarding-tile-label" style={{ marginBottom: 0 }}>
                    {t(`onboarding.sources.${s}.label`)}
                  </div>
                </div>
                <span
                  className="profession-onboarding-tile-check"
                  aria-hidden
                  style={{
                    top: "50%",
                    transform: active ? "translateY(-50%) scale(1)" : "translateY(-50%) scale(0.6)",
                    opacity: active ? 1 : 0,
                  }}
                >
                  <IconCheck size={14} />
                </span>
              </button>
            );
          })}
        </div>

        {/* "Otro" detail input. Renders only when "Otro" is selected so
            the form stays clean when other channels are picked. The
            stagger index continues from where the tile list ended. */}
        {isOther && (
          <div style={{ "--rise-i": 2 + SIGNUP_SOURCES.length }} className="profession-onboarding-tile" >
            <input
              ref={detailRef}
              type="text"
              value={detail}
              onChange={(e) => setDetail(e.target.value.slice(0, SIGNUP_SOURCE_DETAIL_MAX_LEN))}
              placeholder={t("onboarding.sourceOtherPlaceholder")}
              maxLength={SIGNUP_SOURCE_DETAIL_MAX_LEN}
              disabled={saving}
              style={{
                width: "100%",
                background: "transparent",
                border: "none",
                outline: "none",
                fontFamily: "inherit",
                fontSize: 15,
                color: "var(--charcoal)",
                padding: 0,
              }}
              aria-label={t("onboarding.sourceOtherPlaceholder")}
            />
          </div>
        )}

        {err && (
          <div className="form-error profession-onboarding-error">{err}</div>
        )}

        <div className="profession-onboarding-actions" style={{ "--rise-i": 2 + SIGNUP_SOURCES.length + 1 }}>
          <button
            className="btn btn-primary"
            type="button"
            onClick={submit}
            disabled={!canSubmit}
          >
            {saving ? t("onboarding.saving") : t("onboarding.sourceCta")}
          </button>
          {onSignOut && (
            <button
              className="btn btn-ghost"
              type="button"
              onClick={onSignOut}
              disabled={saving}
            >
              {t("nav.signOut")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
