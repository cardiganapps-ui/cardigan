import { useState, useCallback, useMemo } from "react";
import { fetchUserDetail, fetchAuditLog, fetchUserRatings, logAdminViewAs } from "../../hooks/useCardiganData";
import { useT } from "../../i18n/index";
import { UserActionsMenu } from "./parts/UserActionsMenu";
import { TierBadge } from "./parts/TierBadge";
import { useAdminQuery, invalidateAdminCache } from "./useAdminQuery";
import { useAuditLabel } from "./parts/auditLabels";
import { AdminTable } from "./parts/AdminTable";
import { AdminBadge } from "./parts/AdminBadge";
import { AdminEmpty } from "./parts/AdminEmpty";
import { UserActivityTab } from "./parts/UserActivityTab";

function fmtDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" });
}
function fmtDateTime(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short" });
}
/* Relative time — same flavor as the Overview activity feed so the
   admin reads time-since-X consistently across pages. */
function fmtRelativeShort(iso) {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  const days = Math.floor((Date.now() - t) / 86_400_000);
  if (days < 1) return "hoy";
  if (days === 1) return "ayer";
  if (days < 30) return `hace ${days} d`;
  const months = Math.floor(days / 30);
  if (months < 12) return `hace ${months} ${months === 1 ? "mes" : "meses"}`;
  const years = Math.floor(days / 365);
  return `hace ${years} ${years === 1 ? "año" : "años"}`;
}
function fmtMoneyCents(cents, currency = "MXN") {
  const amount = (Number(cents) || 0) / 100;
  return amount.toLocaleString("es-MX", { style: "currency", currency, maximumFractionDigits: 0 });
}
function fmtBytes(b) {
  if (!b || b <= 0 || !Number.isFinite(b)) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.min(sizes.length - 1, Math.floor(Math.log(b) / Math.log(k)));
  return `${(b / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}
function initialsFor(name, email) {
  const src = name || email || "?";
  const parts = src.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

/* ── AdminUserDetail ────────────────────────────────────────────────────
   Flagship page. One server round-trip via /api/admin-user-detail
   composes the entire snapshot. Tabs: Profile / Suscripción / Uso /
   Dispositivos / Auditoría. NO patient PII — counts and metadata only.

   v2 changes:
     • `embedded` prop suppresses the outer wrapper chrome so the page
       can live inside the master-detail split view on AdminUsers
       at ≥1024px. When standalone, behavior is unchanged.
     • Tabs use `.admin-tabs-v2` instead of inline-styled buttons.
     • Inline tables replaced with <AdminTable>.
     • Badges use <AdminBadge>; tier/profession chips reuse the existing
       <TierBadge> (which itself routes through AdminBadge now).
     • Empty states use <AdminEmpty>.
     • Hardcoded Spanish strings routed through useT(). */
export function AdminUserDetail({ uid, onViewAs, onBack, currentAdminId, embedded = false }) {
  const { t } = useT();
  const auditLabel = useAuditLabel();
  const [tab, setTab] = useState("profile");

  const fetcher = useCallback(() => Promise.all([
    fetchUserDetail(uid),
    fetchAuditLog({ targetUserId: uid, limit: 100 }).catch(() => []),
    fetchUserRatings(uid, { limit: 20 }).catch(() => []),
  ]).then(([detail, log, ratings]) => ({ detail, log, ratings })), [uid]);
  const { data: bundle, loading, error, refetch } = useAdminQuery(`user:${uid}`, fetcher);
  const load = refetch;
  const profile = bundle?.detail?.profile || null;
  const subscription = bundle?.detail?.subscription || null;

  const account = useMemo(() => {
    if (!profile) return null;
    const TRIAL_DAYS = 30;
    const PAID = new Set(["active", "past_due"]);
    const compGranted = !!subscription?.comp_granted;
    const status = subscription?.status;
    const paid = status && (
      PAID.has(status)
      || (status === "trialing" && !!subscription?.default_payment_method)
    );
    // eslint-disable-next-line react-hooks/purity
    const now = Date.now();
    const isPatient = !!profile.is_patient;
    let tier = "expired";
    let daysLeftInTrial = null;
    if (isPatient) {
      tier = null;
    } else if (compGranted) {
      tier = "comp";
    } else if (paid) {
      tier = "pro";
    } else {
      const created = profile.created_at ? new Date(profile.created_at).getTime() : null;
      if (created && !Number.isNaN(created)) {
        const totalDays = TRIAL_DAYS + (subscription?.trial_extension_days || 0);
        const trialEndMs = created + totalDays * 86_400_000;
        const left = Math.max(0, Math.ceil((trialEndMs - now) / 86_400_000));
        if (now < trialEndMs) { tier = "trial"; daysLeftInTrial = left; }
        else { tier = "expired"; daysLeftInTrial = 0; }
      }
    }
    const accountType = profile.profession ? "therapist" : (isPatient ? "patient" : "orphan");
    return {
      userId: profile.user_id,
      fullName: profile.full_name || "",
      email: profile.email || "",
      profession: profile.profession || null,
      isPatient,
      accountType,
      blocked: !!profile.banned_until && new Date(profile.banned_until).getTime() > now,
      compGranted,
      tier,
      daysLeftInTrial,
      subscriptionCancelAt: subscription?.cancel_at,
      subscriptionPeriodEnd: subscription?.current_period_end,
      subscriptionCancelAtPeriodEnd: !!subscription?.cancel_at_period_end,
    };
  }, [profile, subscription]);

  if (loading && !bundle) {
    return (
      <DetailContainer embedded={embedded}>
        <DetailSkeleton />
      </DetailContainer>
    );
  }
  if (error && !bundle) {
    return (
      <DetailContainer embedded={embedded}>
        <AdminEmpty title={t("admin.ui.error")} body={String(error)} />
      </DetailContainer>
    );
  }
  if (!bundle) return null;

  const { invoices, usage, devices, privacy } = bundle.detail;
  const audit = bundle.log;
  const ratings = bundle.ratings || [];

  const handleViewAs = async (id) => {
    await logAdminViewAs(id);
    onViewAs?.(id);
  };

  // Tab bar — always-on shape so the strip doesn't reflow when an
  // async-loaded sub-bundle (ratings) lands. The Ratings tab body
  // renders an empty state when there are no ratings yet.
  const TABS = [
    { k: "profile",      l: t("admin.userDetail.tabProfile") },
    { k: "activity",     l: t("admin.userDetail.tabActivity") },
    { k: "subscription", l: t("admin.userDetail.tabSubscription") },
    { k: "usage",        l: t("admin.userDetail.tabUsage") },
    { k: "devices",      l: t("admin.userDetail.tabDevices") },
    { k: "audit",        l: t("admin.userDetail.tabAudit") },
    { k: "ratings",      l: t("admin.userDetail.tabRatings") },
  ];

  return (
    <DetailContainer embedded={embedded}>
      <div className="admin-card">
        <div className="admin-user-header">
          <div className="admin-user-avatar">{initialsFor(profile.full_name, profile.email)}</div>
          <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 6 }}>
            <div className="admin-user-name">
              <span>{profile.full_name || <span style={{ color: "var(--admin-text-faint)", fontStyle: "italic", fontWeight: 600 }}>{t("admin.noName")}</span>}</span>
              {account.isPatient && <AdminBadge tone="info">{t("admin.users.tier.patient")}</AdminBadge>}
              {!account.isPatient && <TierBadge account={account} />}
              {account.blocked && <AdminBadge tone="danger">Bloqueado</AdminBadge>}
            </div>
            {profile.email && (
              <div style={{ fontSize: 12.5, color: "var(--admin-text-meta)", overflowWrap: "anywhere", wordBreak: "break-word", lineHeight: 1.4 }}>
                {profile.email}
              </div>
            )}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 2 }}>
              {profile.profession && (
                <AdminBadge tone="brand">
                  {t(`onboarding.professions.${profile.profession}.label`)}
                </AdminBadge>
              )}
              {profile.created_at && (
                <AdminBadge tone="neutral" title={fmtDate(profile.created_at)}>
                  Alta {fmtRelativeShort(profile.created_at)}
                </AdminBadge>
              )}
            </div>
          </div>
        </div>

        <UserActionsMenu
          account={account}
          currentAdminId={currentAdminId}
          onViewAs={handleViewAs}
          onAction={(meta) => {
            invalidateAdminCache("users:all");
            invalidateAdminCache("audit");
            invalidateAdminCache("overview");
            if (meta?.deleted) onBack?.();
            else load();
          }}
        />
      </div>

      <div className="admin-card" style={{ padding: 0 }}>
        <div className="admin-tabs-v2" role="tablist">
          {TABS.map((tb) => {
            const active = tab === tb.k;
            return (
              <button
                key={tb.k}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setTab(tb.k)}
                className={`admin-tabs-v2-tab${active ? " admin-tabs-v2-tab--active" : ""}`}
              >
                {tb.l}
              </button>
            );
          })}
        </div>
        <div style={{ padding: "14px 18px" }}>
          {tab === "profile" && (
            <>
              <DefList rows={[
                [t("admin.userDetail.labelUserId"), profile.user_id],
                [t("admin.userDetail.labelEmail"), profile.email],
                [t("admin.userDetail.labelName"), profile.full_name || "—"],
                ["Tipo", account.accountType === "patient"
                  ? t("admin.users.tier.patient")
                  : account.accountType === "therapist"
                    ? t("admin.users.tier.therapist")
                    : "Sin perfil"],
                [t("admin.userDetail.labelProfession"), profile.profession ? t(`onboarding.professions.${profile.profession}.label`) : "—"],
                ["Origen de alta", profile.signup_source || "—"],
                profile.signup_source === "other" ? ["Origen detalle", profile.signup_source_detail || "—"] : null,
                ["Origen registrado", fmtDateTime(profile.signup_source_recorded_at)],
                ["Bloqueado hasta", profile.banned_until ? fmtDateTime(profile.banned_until) : "no"],
                [t("admin.userDetail.labelLastSignIn"), fmtDateTime(profile.last_sign_in_at)],
                ["Cuenta creada", fmtDateTime(profile.created_at)],
                ["Cifrado de notas", privacy.encryption_enabled ? `activo (kid: ${privacy.encryption_recovery_kid || "—"})` : "no"],
                ["Aviso de privacidad", privacy.latest_consent_version
                  ? `${privacy.latest_consent_version} · ${fmtDateTime(privacy.latest_consent_at)}`
                  : "—"],
              ].filter(Boolean)} />
            </>
          )}

          {tab === "activity" && (
            <UserActivityTab
              profile={profile}
              subscription={subscription}
              privacy={privacy}
              audit={audit}
            />
          )}

          {tab === "ratings" && (
            ratings.length > 0
              ? <RatingsBlock ratings={ratings} t={t} embedded />
              : <AdminEmpty title={t("admin.userDetail.ratingsEmpty")} />
          )}

          {tab === "subscription" && (
            <>
              {!subscription && account.isPatient && (
                <AdminEmpty
                  title="Cuenta de paciente"
                  body="Los pacientes no se suscriben a Cardigan — el terapeuta paga el plan. Aquí no habrá facturas ni renovaciones."
                />
              )}
              {!subscription && !account.isPatient && (
                <AdminEmpty
                  title="Aún en periodo de prueba"
                  body="Este usuario no ha iniciado un checkout. Cuando se suscriba aparecerán aquí los detalles del plan, las facturas y la fecha de renovación."
                />
              )}
              {subscription && (
                <>
                  <DefList rows={[
                    [t("admin.userDetail.labelStatus"), subscription.status || "—"],
                    ["Plan (price)", subscription.stripe_price_id || "—"],
                    ["Comp otorgada", subscription.comp_granted ? `sí · ${fmtDateTime(subscription.comp_granted_at)}` : "no"],
                    subscription.comp_reason ? ["Comp motivo", subscription.comp_reason] : null,
                    ["Período actual termina", fmtDateTime(subscription.current_period_end)],
                    ["Cancelar al final del período", subscription.cancel_at_period_end ? "sí" : "no"],
                    ["Cancela en", fmtDateTime(subscription.cancel_at)],
                    [t("admin.userDetail.labelTrialEnds"), fmtDateTime(subscription.trial_end)],
                    ["Días extra de prueba", subscription.trial_extension_days || 0],
                    ["Customer (Stripe)", subscription.stripe_customer_id || "—"],
                    ["Subscription (Stripe)", subscription.stripe_subscription_id || "—"],
                    ["Método de pago", subscription.default_payment_method || "—"],
                    ["Código de referido propio", subscription.referral_code || "—"],
                    ["Vino por código", subscription.referred_by || "—"],
                    ["Recompensas referidos", subscription.referral_rewards_count || 0],
                  ].filter(Boolean)} />
                  {invoices && invoices.length > 0 && (
                    <>
                      <h3 style={{ fontFamily: "var(--font-d)", fontSize: 12.5, fontWeight: 800, marginTop: 18, marginBottom: 8, color: "var(--admin-text)" }}>
                        {t("admin.userDetail.sectionInvoices")}
                      </h3>
                      <AdminTable
                        columns={[
                          { key: "created_at", label: t("admin.revenue.colDate"), render: (inv) => fmtDate(inv.created_at), width: 130 },
                          { key: "amount_cents", label: t("admin.revenue.colAmount"), align: "right", width: 110,
                            render: (inv) => fmtMoneyCents(inv.amount_cents, inv.currency || "MXN") },
                          { key: "paid_at", label: t("admin.revenue.colStatus"), width: 100,
                            render: (inv) => inv.paid_at
                              ? <AdminBadge tone="success">{t("admin.revenue.statusPaid")}</AdminBadge>
                              : <AdminBadge tone="neutral">—</AdminBadge> },
                          { key: "hosted_invoice_url", label: "Stripe", width: 90,
                            render: (inv) => inv.hosted_invoice_url
                              ? <a href={inv.hosted_invoice_url} target="_blank" rel="noopener noreferrer" style={{ color: "var(--admin-accent)", fontWeight: 600 }}>Abrir →</a>
                              : "—" },
                        ]}
                        rows={invoices}
                        rowKey={(inv) => inv.id}
                        mobileLayout={(inv) => ({
                          primary: fmtMoneyCents(inv.amount_cents, inv.currency || "MXN"),
                          meta: [<span key="d">{fmtDate(inv.created_at)}</span>],
                          badges: inv.paid_at
                            ? <AdminBadge tone="success">{t("admin.revenue.statusPaid")}</AdminBadge>
                            : <AdminBadge tone="neutral">—</AdminBadge>,
                        })}
                      />
                    </>
                  )}
                </>
              )}
            </>
          )}

          {tab === "usage" && (
            <DefList rows={[
              [t("admin.userDetail.labelPatients"), usage.patients],
              ["Sesiones (total)", usage.sessions_total],
              ["Sesiones (30d)", usage.sessions_30d],
              ["Sesiones completadas", usage.sessions_completed],
              ["Sesiones canceladas", usage.sessions_cancelled],
              ["Sesiones cobradas", usage.sessions_charged],
              ["Pagos (total)", usage.payments_total],
              ["Pagos (30d)", usage.payments_30d],
              ["Notas (total)", usage.notes_total],
              ["Notas cifradas", usage.notes_encrypted],
              ["Documentos (total)", usage.documents_total],
              ["Documentos (bytes)", fmtBytes(usage.documents_bytes)],
              ["Mediciones", usage.measurements_total],
            ]} />
          )}

          {tab === "devices" && (
            <>
              <h3 style={{ fontFamily: "var(--font-d)", fontSize: 12.5, fontWeight: 800, marginBottom: 8, color: "var(--admin-text)" }}>
                {t("admin.userDetail.pushSubsCount", { count: devices.push_subscriptions.length })}
              </h3>
              {devices.push_subscriptions.length === 0 ? (
                <AdminEmpty
                  title="Sin dispositivos con notificaciones"
                  body="El usuario no ha activado los recordatorios push. No recibirá avisos antes de sus sesiones hasta que lo haga desde Ajustes."
                />
              ) : (
                <AdminTable
                  columns={[
                    { key: "endpoint_host", label: "Endpoint host", mono: true,
                      render: (p) => p.endpoint_host || "—" },
                    { key: "created_at", label: "Registrado", width: 180,
                      render: (p) => fmtDateTime(p.created_at) },
                  ]}
                  rows={devices.push_subscriptions}
                  rowKey={(p) => p.id}
                  mobileLayout={(p) => ({
                    primary: p.endpoint_host || "—",
                    meta: [<span key="d">{fmtDateTime(p.created_at)}</span>],
                  })}
                />
              )}
              <h3 style={{ fontFamily: "var(--font-d)", fontSize: 12.5, fontWeight: 800, margin: "16px 0 8px", color: "var(--admin-text)" }}>
                {t("admin.userDetail.sectionCalendar")}
              </h3>
              {devices.calendar_token ? (
                <DefList rows={[
                  [t("admin.userDetail.labelIssuedAt"), fmtDateTime(devices.calendar_token.issued_at)],
                  [t("admin.userDetail.labelLastUsed"), fmtDateTime(devices.calendar_token.last_accessed_at)],
                ]} />
              ) : (
                <AdminEmpty body={t("admin.userDetail.calendarTokenEmpty")} />
              )}
            </>
          )}

          {tab === "audit" && (
            <>
              {audit.length === 0 ? (
                <AdminEmpty
                  title="Cuenta sin intervenciones"
                  body="No hemos bloqueado, otorgado comp ni cambiado nada en esta cuenta. Cualquier acción administrativa se registrará aquí."
                />
              ) : (
                <AdminTable
                  columns={[
                    { key: "created_at", label: t("admin.audit.colDate"), width: 160,
                      render: (r) => <span style={{ whiteSpace: "nowrap" }}>{fmtDateTime(r.created_at)}</span> },
                    { key: "action", label: t("admin.audit.colAction"),
                      render: (r) => <span style={{ fontWeight: 600 }}>{auditLabel(r.action)}</span> },
                    { key: "payload", label: "Datos", mono: true,
                      render: (r) => (
                        <span
                          title={r.payload ? JSON.stringify(r.payload) : ""}
                          style={{ display: "inline-block", maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                        >
                          {r.payload ? JSON.stringify(r.payload) : "—"}
                        </span>
                      ) },
                  ]}
                  rows={audit}
                  rowKey={(r) => r.id}
                  mobileLayout={(r) => ({
                    primary: auditLabel(r.action),
                    secondary: r.payload ? JSON.stringify(r.payload) : null,
                    meta: [<span key="d">{fmtDateTime(r.created_at)}</span>],
                  })}
                />
              )}
            </>
          )}
        </div>
      </div>
    </DetailContainer>
  );
}

/* Outer container. When embedded inside the master-detail split view,
   skip the page-fade wrapper — the split host already provides padding
   and a `key` for the screen-level transition. */
function DetailContainer({ embedded, children }) {
  if (embedded) {
    return <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>{children}</div>;
  }
  return <>{children}</>;
}

function DetailSkeleton() {
  return (
    <>
      <div className="admin-card" aria-busy="true">
        <div className="admin-user-header">
          <span className="sk-circle" style={{ width: 64, height: 64 }} />
          <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 8 }}>
            <span className="sk-bar sk-bar-lg" style={{ width: "45%" }} />
            <span className="sk-bar sk-bar-sm" style={{ width: "65%" }} />
            <span className="sk-bar sk-bar-xs" style={{ width: "30%" }} />
          </div>
        </div>
      </div>
      <div className="admin-card" style={{ padding: 18 }} aria-busy="true">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} style={{ display: "flex", gap: 14, padding: "8px 0" }}>
            <span className="sk-bar sk-bar-sm" style={{ width: 140 }} />
            <span className="sk-bar sk-bar-sm" style={{ flex: 1 }} />
          </div>
        ))}
      </div>
    </>
  );
}

function DefList({ rows }) {
  return (
    <dl className="admin-deflist">
      {rows.map(([label, value], i) => (
        <div key={i} className="admin-deflist-row">
          <dt>{label}</dt>
          <dd>{value === null || value === undefined || value === "" ? "—" : String(value)}</dd>
        </div>
      ))}
    </dl>
  );
}

/* User-rating history block. Rendered inline at the bottom of the
   Profile tab when at least one row exists. Each row: prompt kind,
   N stars (rendered as ★ characters for compactness — admin tool,
   no need for the full SVG icon), optional comment, timestamp. */
function RatingsBlock({ ratings, t, embedded = false }) {
  return (
    <div style={{ marginTop: embedded ? 0 : 24 }}>
      {!embedded && (
        <div className="admin-eyebrow" style={{ marginBottom: 10 }}>
          {t("admin.userDetail.sectionRatings")}
        </div>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {ratings.map((r) => (
          <div
            key={`${r.prompt_kind}-${r.created_at}`}
            style={{
              padding: "10px 12px",
              border: "1px solid var(--admin-border)",
              borderRadius: "var(--radius-sm)",
              background: "var(--admin-surface)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12.5 }}>
              <span style={{ color: "var(--amber, #E8B86C)", letterSpacing: 1 }}>
                {"★".repeat(r.stars)}
                <span style={{ color: "var(--admin-text-faint)" }}>{"★".repeat(5 - r.stars)}</span>
              </span>
              <span style={{ fontFamily: "var(--admin-mono)", color: "var(--admin-text-meta)" }}>
                {r.prompt_kind}
              </span>
              <span style={{ marginLeft: "auto", fontSize: 11.5, color: "var(--admin-text-faint)" }}>
                {fmtDateTime(r.created_at)}
              </span>
            </div>
            {r.comment && (
              <div style={{ marginTop: 6, fontSize: 12.5, color: "var(--admin-text)", lineHeight: 1.45, whiteSpace: "pre-wrap" }}>
                {r.comment}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
