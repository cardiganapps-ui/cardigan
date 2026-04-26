import { useState } from "react";
import { useT } from "../i18n/index";
import { LogoIcon } from "../components/LogoMark";
import { PROFESSIONS } from "../data/constants";

/* ── ProfessionOnboarding ──
   One-time gate shown after sign-up when the user has no row in
   public.user_profiles. Locks the app on the picker until they choose.
   Existing users were backfilled by migration 021 and never see this.

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
    <div className="shell" style={{ background: "var(--cream)", overflow: "auto" }}>
      <div style={{
        maxWidth: 560,
        margin: "0 auto",
        padding: "calc(var(--sat, 0px) + 28px) 20px calc(var(--sab, 0px) + 28px)",
        display: "flex",
        flexDirection: "column",
        gap: 16,
        minHeight: "100%",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <LogoIcon size={22} color="var(--teal)" />
          <span style={{ fontFamily: "var(--font-d)", fontSize: 18, fontWeight: 800, color: "var(--charcoal)", letterSpacing: "-0.3px" }}>cardigan</span>
        </div>

        <div>
          <div style={{ fontFamily: "var(--font-d)", fontSize: 26, fontWeight: 900, color: "var(--charcoal)", letterSpacing: "-0.02em", lineHeight: 1.15, marginBottom: 8 }}>
            {t("onboarding.title")}
          </div>
          <div style={{ fontSize: 15, color: "var(--charcoal-md)", lineHeight: 1.6 }}>
            {t("onboarding.subtitle")}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 4 }}>
          {PROFESSIONS.map((p) => {
            const active = selected === p;
            return (
              <button
                key={p}
                type="button"
                onClick={() => { setSelected(p); setErr(""); }}
                disabled={saving}
                style={{
                  textAlign: "left",
                  padding: "14px 16px",
                  borderRadius: "var(--radius)",
                  background: active ? "var(--teal-pale)" : "var(--white)",
                  border: `2px solid ${active ? "var(--teal)" : "var(--border-lt)"}`,
                  cursor: saving ? "default" : "pointer",
                  fontFamily: "var(--font)",
                  transition: "border-color 0.2s, background 0.2s",
                  boxShadow: active ? "var(--shadow-sm)" : "none",
                }}>
                <div style={{ fontFamily: "var(--font-d)", fontSize: 16, fontWeight: 800, color: "var(--charcoal)", marginBottom: 2 }}>
                  {t(`onboarding.professions.${p}.label`)}
                </div>
                <div style={{ fontSize: 13, color: "var(--charcoal-md)", lineHeight: 1.5 }}>
                  {t(`onboarding.professions.${p}.description`)}
                </div>
              </button>
            );
          })}
        </div>

        {err && (
          <div className="form-error" style={{ marginTop: 4 }}>{err}</div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
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
