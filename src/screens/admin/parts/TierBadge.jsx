import { formatDate } from "../../../utils/format";

/* ── TierBadge ────────────────────────────────────────────────────────
   Single source of truth for "what tier is this account?" pill across
   admin surfaces. Mirrors the original logic from AccountRow's
   tier-pill block (AdminPanel.jsx pre-v2) so the new dashboard renders
   identical badges to the legacy modal during the parity period.

   Shape:
     account: { tier, subscriptionCancelAt, subscriptionPeriodEnd,
                subscriptionCancelAtPeriodEnd, daysLeftInTrial }
*/
export function TierBadge({ account }) {
  if (!account) return null;
  if (account.tier === "pro") {
    const cancelIso = account.subscriptionCancelAt || account.subscriptionPeriodEnd || null;
    const isCancelling = !!account.subscriptionCancelAt || !!account.subscriptionCancelAtPeriodEnd;
    if (isCancelling) {
      let dateStr = null;
      if (cancelIso) {
        try { dateStr = formatDate(cancelIso, "short").replace(/\.$/, ""); }
        catch { /* fall through */ }
      }
      return (
        <span className="badge" style={{ background: "var(--amber-bg)", color: "var(--amber)" }}>
          {dateStr ? `Pro · termina ${dateStr}` : "Pro · cancelada"}
        </span>
      );
    }
    return (
      <span className="badge" style={{ background: "var(--teal-pale)", color: "var(--teal-dark)" }}>Pro</span>
    );
  }
  if (account.tier === "comp") {
    return <span className="badge" style={{ background: "var(--green-bg)", color: "var(--green)" }}>Gratis</span>;
  }
  if (account.tier === "trial") {
    return (
      <span className="badge" style={{ background: "var(--amber-bg)", color: "var(--amber)" }}>
        Prueba: {account.daysLeftInTrial}d
      </span>
    );
  }
  if (account.tier === "expired") {
    return <span className="badge" style={{ background: "var(--red-bg)", color: "var(--red)" }}>Vencida</span>;
  }
  return null;
}
