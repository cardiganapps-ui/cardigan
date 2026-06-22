import { useT } from "../../../i18n/index";

/* ── auditLabels ────────────────────────────────────────────────────────
   Single source of truth for "what does this audit-log action mean in
   Spanish?". Before this file, three separate `ACTION_LABELS` consts
   lived in AdminOverview, AdminAudit, AdminUserDetail — drift between
   them caused identical events to display three different labels.

   Returns a memoized `(actionKey) => string` from the active i18n
   strings. Unknown keys fall back to the raw key so a newly-added
   audit action surfaces as the literal id rather than blanking out. */
export function useAuditLabel() {
  const { t } = useT();
  return (actionKey: string) => {
    if (!actionKey) return "";
    const translated = t(`admin.audit.action.${actionKey}`);
    // i18n returns the key itself when missing; surface the raw action
    // in that case so it's at least debuggable.
    if (translated === `admin.audit.action.${actionKey}`) return actionKey;
    return translated;
  };
}
