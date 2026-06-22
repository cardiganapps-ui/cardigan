import { useState } from "react";
import { fetchInfluencerCodes, toggleInfluencerCode } from "../../hooks/useCardiganData";
import { useT } from "../../i18n/index";
import { haptic } from "../../utils/haptics";
import { IconPlus } from "../../components/Icons";
import { NewCodeSheet } from "./parts/NewCodeSheet";
import { CodeCreatedSheet } from "./parts/CodeCreatedSheet";
import { CopyChip } from "./parts/CopyChip";
import { useAdminQuery, invalidateAdminCache } from "./useAdminQuery";
import { AdminPage } from "./parts/AdminPage";
import { AdminBadge } from "./parts/AdminBadge";
import { AdminEmpty } from "./parts/AdminEmpty";

/* ── AdminCodes ─────────────────────────────────────────────────────────
   Influencer / partner discount codes. Optimistic toggle/create kept;
   layout now wraps in AdminPage with `.admin-row-card` rows instead of
   hand-rolled inline-styled boxes. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- loosely-typed influencer-code rows
type Row = any;

export function AdminCodes() {
  const { t } = useT();
  const [showNew, setShowNew] = useState(false);
  const [justCreated, setJustCreated] = useState<Row | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [toggleError, setToggleError] = useState("");

  const { data: codes = [], loading, error, mutate } = useAdminQuery("codes", fetchInfluencerCodes);

  const onToggle = async (code: Row) => {
    if (busyId) return;
    setBusyId(code.id);
    setToggleError("");
    // Optimistic flip — instant feedback, server confirms shortly
    mutate((prev: Row[]) => (prev || []).map((c: Row) => c.id === code.id ? { ...c, active: !c.active } : c));
    try {
      await toggleInfluencerCode(code.id, !code.active);
      // Acquisition page shows the same codes — drop its slot too.
      invalidateAdminCache("acquisition");
    } catch (e) {
      // Revert the optimistic flip on failure
      mutate((prev: Row[]) => (prev || []).map((c: Row) => c.id === code.id ? { ...c, active: code.active } : c));
      setToggleError((e as Error).message || t("admin.codesToggleError"));
    } finally {
      setBusyId(null);
    }
  };

  const handleCreated = (newCode: Row) => {
    setJustCreated(newCode);
    mutate((prev: Row[]) => [{ ...newCode, signup_count: 0, paid_count: 0 }, ...(prev || [])]);
    invalidateAdminCache("acquisition");
    setShowNew(false);
  };

  const displayError = error || toggleError;
  const initialLoading = loading && codes.length === 0;

  return (
    <>
      <AdminPage
        title={t("admin.codes.title")}
        subtitle={t("admin.codes.subtitle")}
        actions={(
          <button
            type="button"
            onClick={() => { setShowNew(true); haptic.tap(); }}
            className="btn"
            style={{
              height: 32, padding: "0 12px", fontSize: 12.5,
              background: "var(--admin-text)", color: "var(--admin-surface)",
              display: "inline-flex", alignItems: "center", gap: 6, borderRadius: 8,
            }}
          >
            <IconPlus size={14} /> {t("admin.codes.newAction")}
          </button>
        )}
      >
        {displayError && (
          <div
            role="alert"
            style={{
              background: "rgba(197, 68, 59, 0.10)",
              color: "var(--admin-danger)",
              padding: "10px 14px",
              borderRadius: 8,
              fontSize: 12.5,
              border: "1px solid rgba(197, 68, 59, 0.20)",
            }}
          >
            {displayError}
          </div>
        )}

        <AdminPage.Section>
          {initialLoading ? (
            <div style={{ display: "flex", flexDirection: "column" }}>
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="admin-row-card" aria-hidden="true">
                  <span className="sk-bar sk-bar-md" style={{ width: "32%" }} />
                  <span className="sk-bar sk-bar-sm" style={{ width: "55%", marginTop: 4 }} />
                  <span className="sk-bar sk-bar-xs" style={{ width: "70%", marginTop: 4 }} />
                </div>
              ))}
            </div>
          ) : codes.length === 0 ? (
            <AdminEmpty
              title={t("admin.codes.empty")}
              body={t("admin.codes.emptyBody")}
            />
          ) : (
            <div role="list">
              {codes.map((c: Row) => (
                <CodeRow
                  key={c.id}
                  code={c}
                  busy={busyId === c.id}
                  onToggle={() => onToggle(c)}
                  t={t}
                />
              ))}
            </div>
          )}
        </AdminPage.Section>
      </AdminPage>

      {showNew && (
        <NewCodeSheet onClose={() => setShowNew(false)} onCreated={handleCreated} />
      )}
      {justCreated && (
        <CodeCreatedSheet code={justCreated} onClose={() => setJustCreated(null)} />
      )}
    </>
  );
}

function CodeRow({ code, busy, onToggle, t }: {
  code: Row;
  busy?: boolean;
  onToggle: () => void;
  t: (key: string, vars?: Record<string, unknown>) => string;
}) {
  const durationLabel =
    code.duration === "once" ? t("admin.codesDurationOnce")
    : code.duration === "forever" ? t("admin.codesDurationForever")
    : t("admin.codesDurationRepeating", { months: code.duration_in_months });
  const link = `https://cardigan.mx/c/${code.code}`;

  return (
    <div className="admin-row-card" role="listitem" style={{ opacity: code.active ? 1 : 0.6 }}>
      <div className="admin-row-card-row">
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <span style={{
            fontFamily: "var(--admin-mono)",
            fontSize: 13.5,
            fontWeight: 700,
            color: "var(--admin-text)",
            letterSpacing: "0.4px",
          }}>
            {code.code}
          </span>
          {code.active
            ? <AdminBadge tone="success">{t("admin.codesActive")}</AdminBadge>
            : <AdminBadge tone="neutral">{t("admin.codesInactive")}</AdminBadge>}
        </div>
        <button
          type="button"
          onClick={onToggle}
          disabled={busy}
          style={{
            background: "var(--admin-surface)",
            border: "1px solid var(--admin-border)",
            color: "var(--admin-text-meta)",
            padding: "4px 10px",
            fontSize: 11.5,
            fontWeight: 600,
            borderRadius: 999,
            cursor: busy ? "default" : "pointer",
            fontFamily: "inherit",
            flexShrink: 0,
            WebkitTapHighlightColor: "transparent",
          }}
        >
          {code.active ? t("admin.codesDisable") : t("admin.codesEnable")}
        </button>
      </div>
      {code.influencer_name && (
        <div className="admin-row-card-secondary">{code.influencer_name}</div>
      )}
      <div style={{ fontSize: 12.5, color: "var(--admin-text)" }}>
        {t("admin.codesPercent", { percent: code.percent_off })} · {durationLabel}
      </div>
      <div className="admin-row-card-meta">
        {t("admin.codesUsage", { signups: code.signup_count || 0, paid: code.paid_count || 0 })}
      </div>
      <div style={{ paddingTop: 8, borderTop: "1px solid var(--admin-border)", display: "flex", alignItems: "center", gap: 8 }}>
        <CopyChip text={link} label={t("admin.codesShareLink")} />
      </div>
    </div>
  );
}
