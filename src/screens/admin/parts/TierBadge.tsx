import { formatDate } from "../../../utils/format";
import { AdminBadge } from "./AdminBadge";

/* ── TierBadge ──────────────────────────────────────────────────────────
   Single source of truth for "what tier is this account?" pill across
   admin surfaces. Routes through AdminBadge so the dot+text vocabulary
   stays consistent with every other status badge in the admin shell,
   and so dark-mode token swaps work via the --admin-* variables.

   Shape:
     account: { tier, subscriptionCancelAt, subscriptionPeriodEnd,
                subscriptionCancelAtPeriodEnd, daysLeftInTrial }
*/
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- loosely-typed account/subscription row
type Row = any;

export function TierBadge({ account }: { account?: Row }) {
  if (!account) return null;
  if (account.tier === "pro") {
    const cancelIso = account.subscriptionCancelAt || account.subscriptionPeriodEnd || null;
    const isCancelling = !!account.subscriptionCancelAt || !!account.subscriptionCancelAtPeriodEnd;
    if (isCancelling) {
      let dateStr: string | null = null;
      if (cancelIso) {
        try { dateStr = formatDate(cancelIso, "short").replace(/\.$/, ""); }
        catch { /* fall through */ }
      }
      return (
        <AdminBadge tone="warn">
          {dateStr ? `Pro · termina ${dateStr}` : "Pro · cancelada"}
        </AdminBadge>
      );
    }
    return <AdminBadge tone="brand">Pro</AdminBadge>;
  }
  if (account.tier === "comp") {
    return <AdminBadge tone="success">Gratis</AdminBadge>;
  }
  if (account.tier === "trial") {
    return <AdminBadge tone="warn">Prueba: {account.daysLeftInTrial}d</AdminBadge>;
  }
  if (account.tier === "expired") {
    return <AdminBadge tone="danger">Vencida</AdminBadge>;
  }
  return null;
}
