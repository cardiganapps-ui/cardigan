import { useState, useEffect, useCallback } from "react";
import { fetchInfluencerCodes, toggleInfluencerCode } from "../../hooks/useCardiganData";
import { useT } from "../../i18n/index";
import { haptic } from "../../utils/haptics";
import { IconPlus } from "../../components/Icons";
import { NewCodeSheet } from "./parts/NewCodeSheet";
import { CodeCreatedSheet } from "./parts/CodeCreatedSheet";
import { CopyChip } from "./parts/CopyChip";

/* ── AdminCodes ──
   Influencer / partner discount codes. Lifted from CodesTab in
   AdminPanel.jsx with no behavior changes. */
export function AdminCodes() {
  const { t } = useT();
  const [codes, setCodes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [justCreated, setJustCreated] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await fetchInfluencerCodes();
      setCodes(data);
    } catch (e) {
      setError(e.message || t("admin.codesLoadError"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { load(); }, [load]);

  const onToggle = async (code) => {
    if (busyId) return;
    setBusyId(code.id);
    try {
      await toggleInfluencerCode(code.id, !code.active);
      setCodes(prev => prev.map(c => c.id === code.id ? { ...c, active: !c.active } : c));
    } catch (e) {
      setError(e.message || t("admin.codesToggleError"));
    } finally {
      setBusyId(null);
    }
  };

  const handleCreated = (newCode) => {
    setJustCreated(newCode);
    setCodes(prev => [{ ...newCode, signup_count: 0, paid_count: 0 }, ...prev]);
    setShowNew(false);
  };

  return (
    <>
      <div className="admin-card">
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 14 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="admin-card-title">{t("admin.codesTitle")}</div>
            <div className="admin-card-sub">{t("admin.codesSubtitle")}</div>
          </div>
          <button
            type="button"
            onClick={() => { setShowNew(true); haptic.tap(); }}
            className="btn"
            style={{
              height: 36, padding: "0 14px", fontSize: 13,
              background: "var(--charcoal)", color: "var(--white)",
              display: "inline-flex", alignItems: "center", gap: 6, flexShrink: 0,
            }}>
            <IconPlus size={14} /> {t("admin.codesNew")}
          </button>
        </div>

        {loading && <div className="admin-empty">{t("admin.codesLoading")}</div>}
        {error && !loading && (
          <div style={{ background: "var(--red-bg)", color: "var(--red)", padding: "10px 14px", borderRadius: "var(--radius-sm)", fontSize: 13, marginBottom: 10 }}>
            {error}
          </div>
        )}
        {!loading && codes.length === 0 && !error && (
          <div className="admin-empty">{t("admin.codesEmpty")}</div>
        )}
        {!loading && codes.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {codes.map(c => (
              <CodeRow key={c.id} code={c} busy={busyId === c.id} onToggle={() => onToggle(c)} t={t} />
            ))}
          </div>
        )}
      </div>

      {showNew && (
        <NewCodeSheet onClose={() => setShowNew(false)} onCreated={handleCreated} />
      )}
      {justCreated && (
        <CodeCreatedSheet code={justCreated} onClose={() => setJustCreated(null)} />
      )}
    </>
  );
}

function CodeRow({ code, busy, onToggle, t }) {
  const durationLabel =
    code.duration === "once" ? t("admin.codesDurationOnce")
    : code.duration === "forever" ? t("admin.codesDurationForever")
    : t("admin.codesDurationRepeating", { months: code.duration_in_months });
  const link = `https://cardigan.mx/c/${code.code}`;

  return (
    <div style={{
      background: "var(--white)",
      border: "1px solid var(--border-lt)",
      borderRadius: "var(--radius)",
      padding: "12px 14px",
      opacity: code.active ? 1 : 0.6,
    }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2 }}>
            <span style={{
              fontFamily: "var(--font-mono, monospace)",
              fontSize: 14, fontWeight: 700, color: "var(--charcoal)", letterSpacing: "0.4px",
            }}>
              {code.code}
            </span>
            <span style={{
              fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px",
              color: code.active ? "var(--green)" : "var(--charcoal-xl)",
              background: code.active ? "var(--green-bg)" : "var(--cream)",
              padding: "2px 8px", borderRadius: "var(--radius-pill)",
            }}>
              {code.active ? t("admin.codesActive") : t("admin.codesInactive")}
            </span>
          </div>
          {code.influencer_name && (
            <div style={{ fontSize: 12, color: "var(--charcoal-md)", marginBottom: 4 }}>
              {code.influencer_name}
            </div>
          )}
          <div style={{ fontSize: 13, color: "var(--charcoal)", marginBottom: 2 }}>
            {t("admin.codesPercent", { percent: code.percent_off })} · {durationLabel}
          </div>
          <div style={{ fontSize: 11, color: "var(--charcoal-xl)" }}>
            {t("admin.codesUsage", { signups: code.signup_count || 0, paid: code.paid_count || 0 })}
          </div>
        </div>
        <button type="button" onClick={onToggle} disabled={busy}
          style={{
            background: "none", border: "1px solid var(--border)", color: "var(--charcoal-md)",
            padding: "4px 10px", fontSize: 11, fontWeight: 600,
            borderRadius: "var(--radius-pill)", cursor: busy ? "default" : "pointer",
            fontFamily: "inherit", flexShrink: 0, WebkitTapHighlightColor: "transparent",
          }}>
          {code.active ? t("admin.codesDisable") : t("admin.codesEnable")}
        </button>
      </div>
      <div style={{
        marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--border-lt)",
        display: "flex", alignItems: "center", gap: 8,
      }}>
        <CopyChip text={link} label={t("admin.codesShareLink")} />
      </div>
    </div>
  );
}
