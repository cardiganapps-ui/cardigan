import { useMemo } from "react";
import { useAuditLabel } from "./auditLabels";
import { AdminEmpty } from "./AdminEmpty";

function fmtDateTime(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short" });
}

function fmtRelative(iso) {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "—";
  const diff = Date.now() - t;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "ahora";
  if (mins < 60) return `hace ${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `hace ${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return "ayer";
  if (days < 30) return `hace ${days}d`;
  const months = Math.floor(days / 30);
  if (months < 12) return `hace ${months}mo`;
  const years = Math.floor(days / 365);
  return `hace ${years}a`;
}

/* ── UserActivityTab ────────────────────────────────────────────────────
   Per-user activity stream merging admin actions (admin_audit_log) with
   the user's own lifecycle events (signup, subscription start/cancel,
   comp grant, encryption setup, latest privacy consent).

   Unlike the Auditoría tab — which is admin-actions only — this tab
   gives the admin a single chronological narrative of "what's
   happened with this user" so an investigation doesn't require
   cross-referencing three tabs. */
export function UserActivityTab({ profile, subscription, privacy, audit }) {
  const auditLabel = useAuditLabel();

  const events = useMemo(() => {
    const out = [];

    // Lifecycle events derived from the user's own data
    if (profile?.created_at) {
      out.push({
        kind: "lifecycle",
        at: profile.created_at,
        label: "Cuenta creada",
        sub: profile.email || profile.user_id?.slice(0, 8),
      });
    }
    if (profile?.last_sign_in_at && profile.last_sign_in_at !== profile.created_at) {
      out.push({
        kind: "lifecycle",
        at: profile.last_sign_in_at,
        label: "Último acceso",
      });
    }
    if (subscription?.created_at) {
      out.push({
        kind: "lifecycle",
        at: subscription.created_at,
        label: "Suscripción iniciada",
        sub: subscription.stripe_price_id || null,
      });
    }
    if (subscription?.comp_granted && subscription?.comp_granted_at) {
      out.push({
        kind: "lifecycle",
        at: subscription.comp_granted_at,
        label: "Comp otorgada",
        sub: subscription.comp_reason || null,
      });
    }
    if (subscription?.cancel_at) {
      out.push({
        kind: "lifecycle",
        at: subscription.cancel_at,
        label: "Cancelación programada",
      });
    }
    if (privacy?.encryption_enabled && privacy?.encryption_set_up_at) {
      out.push({
        kind: "lifecycle",
        at: privacy.encryption_set_up_at,
        label: "Cifrado de notas activado",
      });
    }
    if (privacy?.latest_consent_at && privacy?.latest_consent_version) {
      out.push({
        kind: "lifecycle",
        at: privacy.latest_consent_at,
        label: `Aviso de privacidad aceptado (${privacy.latest_consent_version})`,
      });
    }

    // Admin audit log targeting this user
    for (const row of audit || []) {
      out.push({
        kind: "audit",
        at: row.created_at,
        label: auditLabel(row.action),
        actorId: row.actor_id,
        payload: row.payload,
        id: row.id,
      });
    }

    return out
      .filter((e) => e.at)
      .sort((a, b) => (b.at || "").localeCompare(a.at || ""));
  }, [profile, subscription, privacy, audit, auditLabel]);

  if (events.length === 0) {
    return (
      <AdminEmpty
        title="Sin actividad registrada"
        body="Cuando ocurran eventos en esta cuenta (altas, cambios de plan, acciones de admin), aparecerán aquí en orden cronológico."
      />
    );
  }

  return (
    <div>
      {events.map((e, i) => (
        <div key={e.id || `${e.kind}:${e.at}:${i}`} className="admin-activity-row">
          <span
            className="admin-activity-row-icon"
            style={{
              background: e.kind === "audit" ? "var(--admin-accent-soft)" : "var(--admin-surface-2)",
              color: e.kind === "audit" ? "var(--admin-accent)" : "var(--admin-text-meta)",
            }}
            aria-hidden="true"
          >
            {e.kind === "audit" ? "⚙" : "•"}
          </span>
          <span className="admin-activity-row-body">
            <span className="admin-activity-row-actor">{e.label}</span>
            {e.sub && (
              <>
                {" "}<span className="admin-activity-row-target">{typeof e.sub === "string" ? e.sub : JSON.stringify(e.sub)}</span>
              </>
            )}
            {e.kind === "audit" && e.actorId && (
              <>
                {" "}
                <span className="admin-activity-row-target">admin {e.actorId.slice(0, 8)}…</span>
              </>
            )}
          </span>
          <span className="admin-activity-row-time" title={fmtDateTime(e.at)}>
            {fmtRelative(e.at)}
          </span>
        </div>
      ))}
    </div>
  );
}
