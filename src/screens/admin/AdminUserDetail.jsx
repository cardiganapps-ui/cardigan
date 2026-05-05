import { useState, useEffect, useCallback } from "react";
import { fetchUserDetail, fetchAuditLog, logAdminViewAs } from "../../hooks/useCardiganData";
import { useT } from "../../i18n/index";
import { UserActionsMenu } from "./parts/UserActionsMenu";

function fmtDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" });
}
function fmtDateTime(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short" });
}
function fmtMoneyCents(cents, currency = "MXN") {
  const amount = (Number(cents) || 0) / 100;
  return amount.toLocaleString("es-MX", { style: "currency", currency, maximumFractionDigits: 0 });
}
function fmtBytes(b) {
  // Guard non-positive (corrupt rows can produce negatives or NaN —
  // Math.log(<=0) returns NaN/-Infinity and the unit lookup goes
  // sideways, surfacing "NaN undefined" to the admin).
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

const TABS = [
  { k: "profile", l: "Perfil" },
  { k: "subscription", l: "Suscripción" },
  { k: "usage", l: "Uso" },
  { k: "devices", l: "Dispositivos" },
  { k: "audit", l: "Auditoría" },
];

const ACTION_LABELS = {
  block_user: "Bloqueado",
  unblock_user: "Desbloqueado",
  delete_user: "Eliminado",
  update_profession: "Cambio de profesión",
  grant_comp: "Comp otorgada",
  revoke_comp: "Comp revocada",
  recover_encryption: "Recuperación de cifrado",
  view_as: "Ver como usuario",
  create_code: "Código creado",
  toggle_code: "Código alternado",
};

/* ── AdminUserDetail ──
   Flagship page. One server round-trip via /api/admin-user-detail
   composes the entire snapshot. Tabs: Profile / Suscripción / Uso /
   Dispositivos / Auditoría. NO patient PII — counts and metadata
   only. */
export function AdminUserDetail({ uid, onViewAs, onBack, currentAdminId }) {
  const { t } = useT();
  const [data, setData] = useState(null);
  const [audit, setAudit] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tab, setTab] = useState("profile");

  // Refresh count gives us a manual reload trigger without changing
  // the cancellation key. The user-id-keyed effect below owns its own
  // cancellation flag so a slower request for an old uid can't
  // overwrite a fresher request for a new uid (textbook race seen
  // when the admin clicks user A then user B before A resolves).
  const [refreshCount, setRefreshCount] = useState(0);
  const load = useCallback(() => setRefreshCount((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    (async () => {
      try {
        const [detail, log] = await Promise.all([
          fetchUserDetail(uid),
          fetchAuditLog({ targetUserId: uid, limit: 100 }).catch(() => []),
        ]);
        if (cancelled) return;
        setData(detail);
        setAudit(log);
      } catch (e) {
        if (cancelled) return;
        setError(e.message || "Error al cargar");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [uid, refreshCount]);

  if (loading) return <div className="admin-empty">Cargando…</div>;
  if (error) return <div className="admin-empty" style={{ color: "var(--red)" }}>{error}</div>;
  if (!data) return null;

  const { profile, subscription, invoices, usage, devices, privacy } = data;

  // Build a synthetic account-like object so UserActionsMenu sees the
  // same shape it does in the Users list. Tier resolution mirrors
  // fetchAllAccounts in useCardiganData.js so a user opened directly
  // via #admin/users/<uid> renders the SAME badge as in the list —
  // including the "expired" state the prior implementation collapsed
  // into "trial".
  const TRIAL_DAYS = 30;
  const PAID = new Set(["active", "past_due"]);
  const compGranted = !!subscription?.comp_granted;
  const status = subscription?.status;
  const paid = status && (
    PAID.has(status)
    || (status === "trialing" && !!subscription?.default_payment_method)
  );
  let tier = "expired";
  let daysLeftInTrial = null;
  if (compGranted) {
    tier = "comp";
  } else if (paid) {
    tier = "pro";
  } else {
    const created = profile.created_at ? new Date(profile.created_at).getTime() : null;
    if (created && !Number.isNaN(created)) {
      const totalDays = TRIAL_DAYS + (subscription?.trial_extension_days || 0);
      const trialEndMs = created + totalDays * 86_400_000;
      const left = Math.max(0, Math.ceil((trialEndMs - Date.now()) / 86_400_000));
      if (Date.now() < trialEndMs) { tier = "trial"; daysLeftInTrial = left; }
      else { tier = "expired"; daysLeftInTrial = 0; }
    }
  }
  const account = {
    userId: profile.user_id,
    fullName: profile.full_name || "",
    email: profile.email || "",
    profession: profile.profession || "psychologist",
    blocked: !!profile.banned_until && new Date(profile.banned_until).getTime() > Date.now(),
    compGranted,
    tier,
    daysLeftInTrial,
    subscriptionCancelAt: subscription?.cancel_at,
    subscriptionPeriodEnd: subscription?.current_period_end,
    subscriptionCancelAtPeriodEnd: !!subscription?.cancel_at_period_end,
  };

  const handleViewAs = async (id) => {
    await logAdminViewAs(id);
    onViewAs?.(id);
  };

  return (
    <>
      <div className="admin-card">
        <div className="admin-user-header">
          <div className="admin-user-avatar">{initialsFor(profile.full_name, profile.email)}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="admin-user-name">
              <span>{profile.full_name || profile.email || "—"}</span>
              {account.blocked && <span className="badge badge-red">Bloqueado</span>}
            </div>
            <div className="admin-user-meta">
              <span style={{ wordBreak: "break-all" }}>{profile.email}</span>
              {profile.profession && (
                <span style={{ color: "var(--teal-dark)", fontWeight: 600 }}>
                  · {t(`onboarding.professions.${profile.profession}.label`)}
                </span>
              )}
              <span>· Alta {fmtDate(profile.created_at)}</span>
              <span>· Último acceso {fmtDateTime(profile.last_sign_in_at)}</span>
            </div>
          </div>
        </div>

        <div className="admin-user-actions">
          <UserActionsMenu
            account={account}
            currentAdminId={currentAdminId}
            onViewAs={handleViewAs}
            onAction={(meta) => {
              if (meta?.deleted) onBack?.();
              else load();
            }}
          />
        </div>
      </div>

      <div className="admin-card" style={{ padding: 0 }}>
        <div style={{ display: "flex", gap: 0, borderBottom: "1px solid var(--border-lt)", overflowX: "auto" }} className="admin-tab-stack">
          {TABS.map((tb) => {
            const active = tab === tb.k;
            return (
              <button key={tb.k} type="button"
                onClick={() => setTab(tb.k)}
                style={{
                  padding: "12px 16px",
                  background: "none",
                  border: "none",
                  borderBottom: active ? "2px solid var(--teal)" : "2px solid transparent",
                  color: active ? "var(--charcoal)" : "var(--charcoal-xl)",
                  fontFamily: "inherit",
                  fontSize: 13,
                  fontWeight: 700,
                  cursor: "pointer",
                  flexShrink: 0,
                }}>
                {tb.l}
              </button>
            );
          })}
        </div>
        <div style={{ padding: "16px 20px" }}>
          {tab === "profile" && (
            <DefList rows={[
              ["User ID", profile.user_id],
              ["Email", profile.email],
              ["Nombre", profile.full_name || "—"],
              ["Profesión", profile.profession ? t(`onboarding.professions.${profile.profession}.label`) : "—"],
              ["Origen de alta", profile.signup_source || "—"],
              profile.signup_source === "other" ? ["Origen detalle", profile.signup_source_detail || "—"] : null,
              ["Origen registrado", fmtDateTime(profile.signup_source_recorded_at)],
              ["Bloqueado hasta", profile.banned_until ? fmtDateTime(profile.banned_until) : "no"],
              ["Último acceso", fmtDateTime(profile.last_sign_in_at)],
              ["Cuenta creada", fmtDateTime(profile.created_at)],
              ["Cifrado de notas", privacy.encryption_enabled ? `activo (kid: ${privacy.encryption_recovery_kid || "—"})` : "no"],
              ["Aviso de privacidad", privacy.latest_consent_version
                ? `${privacy.latest_consent_version} · ${fmtDateTime(privacy.latest_consent_at)}`
                : "—"],
            ].filter(Boolean)} />
          )}

          {tab === "subscription" && (
            <>
              {!subscription && (
                <div className="admin-empty">Sin suscripción registrada.</div>
              )}
              {subscription && (
                <>
                  <DefList rows={[
                    ["Estado", subscription.status || "—"],
                    ["Plan (price)", subscription.stripe_price_id || "—"],
                    ["Comp otorgada", subscription.comp_granted ? `sí · ${fmtDateTime(subscription.comp_granted_at)}` : "no"],
                    subscription.comp_reason ? ["Comp motivo", subscription.comp_reason] : null,
                    ["Período actual termina", fmtDateTime(subscription.current_period_end)],
                    ["Cancelar al final del período", subscription.cancel_at_period_end ? "sí" : "no"],
                    ["Cancela en", fmtDateTime(subscription.cancel_at)],
                    ["Fin de prueba", fmtDateTime(subscription.trial_end)],
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
                      <h3 style={{ fontFamily: "var(--font-d)", fontSize: 13, fontWeight: 800, marginTop: 18, marginBottom: 8 }}>
                        Últimas facturas
                      </h3>
                      <table className="admin-table">
                        <thead>
                          <tr>
                            <th>Fecha</th>
                            <th style={{ textAlign: "right" }}>Monto</th>
                            <th>Estado</th>
                            <th>Stripe</th>
                          </tr>
                        </thead>
                        <tbody>
                          {invoices.map((inv) => (
                            <tr key={inv.id}>
                              <td>{fmtDate(inv.created_at)}</td>
                              <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                                {fmtMoneyCents(inv.amount_cents, inv.currency || "MXN")}
                              </td>
                              <td>{inv.paid_at ? <span className="badge badge-green">Pagada</span> : "—"}</td>
                              <td>
                                {inv.hosted_invoice_url ? (
                                  <a href={inv.hosted_invoice_url} target="_blank" rel="noopener noreferrer"
                                    style={{ color: "var(--teal-dark)", fontWeight: 600 }}>
                                    Abrir →
                                  </a>
                                ) : "—"}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </>
                  )}
                </>
              )}
            </>
          )}

          {tab === "usage" && (
            <DefList rows={[
              ["Pacientes", usage.patients],
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
              <h3 style={{ fontFamily: "var(--font-d)", fontSize: 13, fontWeight: 800, marginBottom: 8 }}>
                Push subscriptions ({devices.push_subscriptions.length})
              </h3>
              {devices.push_subscriptions.length === 0 ? (
                <div className="admin-empty">Sin dispositivos registrados.</div>
              ) : (
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Endpoint host</th>
                      <th>Registrado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {devices.push_subscriptions.map((p) => (
                      <tr key={p.id}>
                        <td style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 12 }}>{p.endpoint_host || "—"}</td>
                        <td>{fmtDateTime(p.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <h3 style={{ fontFamily: "var(--font-d)", fontSize: 13, fontWeight: 800, margin: "16px 0 8px" }}>
                Token de calendario
              </h3>
              {devices.calendar_token ? (
                <DefList rows={[
                  ["Emitido", fmtDateTime(devices.calendar_token.issued_at)],
                  ["Último uso", fmtDateTime(devices.calendar_token.last_accessed_at)],
                ]} />
              ) : (
                <div className="admin-empty" style={{ padding: 20 }}>Sin token activo.</div>
              )}
            </>
          )}

          {tab === "audit" && (
            <>
              {audit.length === 0 ? (
                <div className="admin-empty">Sin eventos registrados para este usuario.</div>
              ) : (
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Fecha</th>
                      <th>Acción</th>
                      <th>Datos</th>
                    </tr>
                  </thead>
                  <tbody>
                    {audit.map((r) => (
                      <tr key={r.id}>
                        <td style={{ whiteSpace: "nowrap" }}>{fmtDateTime(r.created_at)}</td>
                        <td style={{ fontWeight: 600 }}>{ACTION_LABELS[r.action] || r.action}</td>
                        <td title={r.payload ? JSON.stringify(r.payload) : ""}
                          style={{
                            fontSize: 11, fontFamily: "var(--font-mono, monospace)", color: "var(--charcoal-xl)",
                            maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                          }}>
                          {r.payload ? JSON.stringify(r.payload) : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}

function DefList({ rows }) {
  return (
    <dl style={{ margin: 0, display: "grid", gridTemplateColumns: "200px 1fr", rowGap: 8, columnGap: 16 }}>
      {rows.map(([label, value], i) => (
        <div key={i} style={{ display: "contents" }}>
          <dt style={{ fontSize: 12, color: "var(--charcoal-xl)", fontWeight: 600 }}>{label}</dt>
          <dd style={{ margin: 0, fontSize: 13, color: "var(--charcoal)", wordBreak: "break-word" }}>
            {value === null || value === undefined || value === "" ? "—" : String(value)}
          </dd>
        </div>
      ))}
    </dl>
  );
}
