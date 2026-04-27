import { useState } from "react";
import { useT } from "../i18n/index";
import { LogoIcon } from "../components/LogoMark";
import { IconCheck } from "../components/Icons";
import { PROFESSIONS } from "../data/constants";
import { haptic } from "../utils/haptics";

/* ── ProfessionOnboarding ──
   One-time gate shown after sign-up when the user has no row in
   public.user_profiles. Locks the app on the picker until they choose.
   Existing users were backfilled by migration 021 and never see this.

   Polish details:
   - Logo + headline + tiles + footer all rise into place via stagger
     animation (`onboarding-rise`, ~80ms each) on first paint.
   - Active tile scales 1 → 1.02 with a checkmark badge in the top-right.
   - Tile selection fires haptic.tap() so the tile picker feels chosen,
     not just hovered.

   `onSelect(profession)` is expected to return a boolean indicating
   whether the row was created. On false we leave the spinner state up
   and surface an inline error so the user can retry. */
export function ProfessionOnboarding({ onSelect, onSignOut }) {
  const { t } = useT();
  const [selected, setSelected] = useState(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const submit = async () => {
    if (!selected || saving) return;
    setSaving(true);
    setErr("");
    const ok = await onSelect(selected);
    if (!ok) {
      setSaving(false);
      setErr(t("onboarding.error"));
    }
    // On success, the parent unmounts this screen — nothing left to do.
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
            {t("onboarding.title")}
          </div>
          <div className="profession-onboarding-subtitle">
            {t("onboarding.subtitle")}
          </div>
        </div>

        <div className="profession-onboarding-tiles">
          {PROFESSIONS.map((p, i) => {
            const active = selected === p;
            return (
              <button
                key={p}
                type="button"
                className={`profession-onboarding-tile ${active ? "profession-onboarding-tile--active" : ""}`}
                style={{ "--rise-i": 2 + i }}
                onClick={() => { setSelected(p); setErr(""); haptic.tap(); }}
                disabled={saving}
                aria-pressed={active}>
                <div className="profession-onboarding-tile-content">
                  <div className="profession-onboarding-tile-label">
                    {t(`onboarding.professions.${p}.label`)}
                  </div>
                  <div className="profession-onboarding-tile-description">
                    {t(`onboarding.professions.${p}.description`)}
                  </div>
                </div>
                <span
                  className="profession-onboarding-tile-check"
                  aria-hidden
                  style={{ opacity: active ? 1 : 0, transform: active ? "scale(1)" : "scale(0.6)" }}>
                  <IconCheck size={14} />
                </span>
              </button>
            );
          })}
        </div>

        {err && (
          <div className="form-error profession-onboarding-error">{err}</div>
        )}

        <div className="profession-onboarding-actions" style={{ "--rise-i": 2 + PROFESSIONS.length }}>
          <button
            className="btn btn-primary"
            type="button"
            onClick={submit}
            disabled={!selected || saving}>
            {saving ? t("onboarding.saving") : t("onboarding.cta")}
          </button>
          {onSignOut && (
            <button
              className="btn btn-ghost"
              type="button"
              onClick={onSignOut}
              disabled={saving}>
              {t("nav.signOut")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
