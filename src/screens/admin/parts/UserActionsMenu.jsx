import { useState } from "react";
import { IconTrash, IconChevron } from "../../../components/Icons";
import { useT } from "../../../i18n/index";
import { haptic } from "../../../utils/haptics";
import { PROFESSIONS } from "../../../data/constants";
import { useCardigan } from "../../../context/CardiganContext";
import {
  adminBlockUser,
  adminDeleteUser,
  adminUpdateProfession,
  adminGrantComp,
} from "../../../hooks/useCardiganData";

/* ── UserActionsMenu ──
   The admin-action surface for User Detail. Wraps:
     - View as user (primary)
     - Block / Unblock (with confirmation)
     - Delete (with type-to-confirm)
     - Change profession (two-step)
     - Toggle comp (always-free) access

   Default layout:
     [ Ver como ]    [ Más opciones ▾ ]
     ▼ when expanded:
       Profession  [select]
       Acceso      [comp toggle]
       [Bloquear / Desbloquear]   [Eliminar]

   The expandable disclosure replaces the previous always-expanded
   three-row stack that ate ~150px of vertical real estate. The
   primary "Ver como" remains one tap away; secondary actions are
   one tap behind a clear affordance.

   `compact` prop is a legacy escape hatch (was used by an inline
   AccountRow that no longer exists) and now does nothing — left in
   the signature to avoid breaking any caller that still passes it.
*/
// eslint-disable-next-line no-unused-vars
export function UserActionsMenu({ account, currentAdminId, onViewAs, onAction, compact = false }) {
  const { t } = useT();
  const { setProfessionLocal } = useCardigan();
  const [mode, setMode] = useState("default"); // default | confirmBlock | confirmDelete
  // Disclosure state for the secondary action panel. Collapsed by
  // default — the admin sees only "Ver como" + "Más opciones ▾"
  // until they explicitly need a destructive or configuration action.
  const [moreOpen, setMoreOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [pendingProfession, setPendingProfession] = useState(null);
  const [professionBusy, setProfessionBusy] = useState(false);
  const [professionErr, setProfessionErr] = useState("");
  const [compBusy, setCompBusy] = useState(false);
  const [compErr, setCompErr] = useState("");

  // Defensive: account.userId should always be a uuid, but guarding
  // means a bad row from a future RPC change can't crash the entire
  // admin surface. Same for email — null-safe before .trim().
  const userIdSafe = account.userId || "";
  const emailSafe = account.email || "";
  const isSelf = !!userIdSafe && userIdSafe === currentAdminId;
  const emailLabel = emailSafe || `ID: ${userIdSafe.slice(0, 8) || "?"}…`;
  const deleteConfirmMatches = emailSafe
    ? deleteConfirmText.trim().toLowerCase() === emailSafe.trim().toLowerCase()
    : false;

  const reset = () => { setMode("default"); setErr(""); setDeleteConfirmText(""); };

  const doBlock = async (block) => {
    setBusy(true); setErr("");
    try { await adminBlockUser(account.userId, block); onAction?.(); reset(); }
    catch (e) { setErr(e.message || t("admin.actionError")); }
    finally { setBusy(false); }
  };

  const doDelete = async () => {
    setBusy(true); setErr("");
    try { await adminDeleteUser(account.userId); onAction?.({ deleted: true }); reset(); }
    catch (e) { setErr(e.message || t("admin.actionError")); }
    finally { setBusy(false); }
  };

  const doChangeProfession = async (next) => {
    if (!next || next === account.profession) { setPendingProfession(null); return; }
    setProfessionBusy(true); setProfessionErr("");
    try {
      await adminUpdateProfession(account.userId, next);
      if (isSelf && setProfessionLocal) setProfessionLocal(next);
      haptic.tap();
      setPendingProfession(null);
      onAction?.();
    } catch (e) {
      setProfessionErr(e.message || t("adminProfession.saveFailed"));
    } finally {
      setProfessionBusy(false);
    }
  };

  if (mode === "confirmBlock") {
    return (
      <div style={{ padding: "0 0 4px" }}>
        <div style={{ background: account.blocked ? "var(--green-bg)" : "var(--amber-bg)", borderRadius: "var(--radius)", padding: "12px 14px", marginBottom: 10 }}>
          <div style={{ fontFamily: "var(--font-d)", fontSize: "var(--text-md)", fontWeight: 800, color: "var(--charcoal)", marginBottom: 4 }}>
            {account.blocked
              ? t("admin.unblockTitle", { email: emailLabel })
              : t("admin.blockTitle", { email: emailLabel })}
          </div>
          <div style={{ fontSize: "var(--text-sm)", color: "var(--charcoal-md)", lineHeight: 1.5 }}>
            {account.blocked ? t("admin.unblockBody") : t("admin.blockBody")}
          </div>
        </div>
        {err && <div className="form-error">{err}</div>}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <button className="btn btn-secondary" onClick={reset} disabled={busy}>{t("cancel")}</button>
          <button className="btn"
            style={{ background: account.blocked ? "var(--green)" : "var(--amber)", color: "var(--white)", boxShadow: "none" }}
            onClick={() => doBlock(!account.blocked)} disabled={busy}>
            {busy ? t("admin.processing") : (account.blocked ? t("admin.unblockConfirm") : t("admin.blockConfirm"))}
          </button>
        </div>
      </div>
    );
  }

  if (mode === "confirmDelete") {
    return (
      <div style={{ padding: "0 0 4px" }}>
        <div style={{ textAlign: "center", margin: "6px 0 10px" }}>
          <div style={{ width: 52, height: 52, borderRadius: "50%", background: "var(--red-bg)", color: "var(--red)", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
            <IconTrash size={22} />
          </div>
        </div>
        <div style={{ fontFamily: "var(--font-d)", fontSize: "var(--text-md)", fontWeight: 800, color: "var(--charcoal)", textAlign: "center", marginBottom: 6, letterSpacing: "-0.2px" }}>
          {t("admin.deleteAccountTitle", { email: emailLabel })}
        </div>
        <div style={{ fontSize: "var(--text-sm)", color: "var(--charcoal-md)", lineHeight: 1.5, textAlign: "center", marginBottom: 12 }}>
          {t("admin.deleteAccountWarning")}
        </div>

        <div style={{ background: "var(--red-bg)", borderRadius: "var(--radius)", padding: "10px 14px", marginBottom: 10 }}>
          <div style={{ fontSize: "var(--text-xs)", fontWeight: 700, color: "var(--red)", marginBottom: 6 }}>
            {t("admin.deleteAccountLost")}
          </div>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: "var(--text-sm)", color: "var(--charcoal-md)", lineHeight: 1.6 }}>
            <li>{t("admin.deleteAccountLostData")}</li>
            <li>{t("admin.deleteAccountLostFiles")}</li>
            <li>{t("admin.deleteAccountLostAuth", { email: emailLabel })}</li>
          </ul>
        </div>

        {!account.blocked && (
          <div style={{ background: "var(--teal-pale)", borderRadius: "var(--radius)", padding: "10px 14px", marginBottom: 10 }}>
            <div style={{ fontSize: "var(--text-xs)", fontWeight: 700, color: "var(--teal-dark)", marginBottom: 4 }}>
              {t("admin.deleteAccountAlternativeTitle")}
            </div>
            <div style={{ fontSize: "var(--text-sm)", color: "var(--charcoal-md)", lineHeight: 1.5, marginBottom: 10 }}>
              {t("admin.deleteAccountAlternativeBody")}
            </div>
            <button type="button"
              onClick={() => { setDeleteConfirmText(""); setErr(""); setMode("confirmBlock"); }}
              className="btn btn-secondary" style={{ width: "100%", height: 36, fontSize: "var(--text-sm)" }}>
              {t("admin.deleteAccountAlternativeCta")}
            </button>
          </div>
        )}

        <div className="input-group">
          <label className="input-label">{t("admin.deleteAccountTypeToConfirm", { email: emailLabel })}</label>
          <input className="input"
            value={deleteConfirmText}
            onChange={e => setDeleteConfirmText(e.target.value)}
            placeholder={t("admin.deleteAccountTypePlaceholder")}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false} />
        </div>

        {err && <div className="form-error">{err}</div>}

        <button className="btn btn-danger" style={{ marginBottom: 8 }}
          onClick={doDelete}
          disabled={busy || !deleteConfirmMatches || !account.email}>
          {busy ? t("admin.processing") : t("admin.deleteAccountConfirm")}
        </button>
        <button className="btn btn-secondary w-full" onClick={reset} disabled={busy}>
          {t("cancel")}
        </button>
      </div>
    );
  }

  // Default mode — compact action bar with disclosure for secondary actions.
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
      {/* Primary action bar — Ver como (one tap) + a single Más
          opciones disclosure for everything else. Single horizontal
          row at any viewport. */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <button className="btn"
          style={{ flex: "1 1 160px", height: 36, fontSize: "var(--text-sm)", background: "var(--teal)", color: "var(--white)", boxShadow: "none", minWidth: 0 }}
          onClick={() => onViewAs?.(account.userId)}>
          {t("admin.view")}
        </button>
        <button type="button"
          aria-expanded={moreOpen}
          onClick={() => setMoreOpen((v) => !v)}
          style={{
            height: 36, padding: "0 14px", fontSize: "var(--text-sm)", fontWeight: 600,
            display: "inline-flex", alignItems: "center", gap: 6,
            background: "var(--white)", border: "1px solid var(--border)",
            borderRadius: "var(--radius-pill)", color: "var(--charcoal-md)",
            cursor: "pointer", fontFamily: "inherit",
            transition: "background-color var(--dur-fast) ease, border-color var(--dur-fast) ease, color var(--dur-fast) ease",
          }}>
          {t("admin.moreOptions")}
          <span aria-hidden style={{ display: "inline-flex", transform: moreOpen ? "rotate(90deg)" : "rotate(0deg)", transition: "transform var(--dur-fast) ease" }}>
            <IconChevron size={12} />
          </span>
        </button>
      </div>

      {/* Disclosure panel — collapsed by default. Holds profession,
          comp, block, delete in a single tidy stack. */}
      {moreOpen && (
        <div style={{
          marginTop: 14, paddingTop: 14,
          borderTop: "1px solid var(--border-lt)",
          display: "flex", flexDirection: "column", gap: 12,
          animation: "fadeIn 0.18s ease",
        }}>
          {/* Profession row */}
          <div style={{ display: "grid", gridTemplateColumns: "minmax(120px, 140px) 1fr", gap: 12, alignItems: "center" }}>
            <span style={{ fontSize: 12, color: "var(--charcoal-xl)", fontWeight: 700 }}>
              {t("adminProfession.label")}
            </span>
            <select
              className="input"
              value={pendingProfession ?? account.profession ?? "psychologist"}
              disabled={professionBusy}
              onChange={(e) => {
                setProfessionErr("");
                setPendingProfession(e.target.value === account.profession ? null : e.target.value);
              }}
              style={{ height: 34, fontSize: "var(--text-sm)", padding: "0 10px" }}>
              {PROFESSIONS.map((p) => (
                <option key={p} value={p}>{t(`onboarding.professions.${p}.label`)}</option>
              ))}
            </select>
          </div>
          {pendingProfession && (
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn"
                style={{ flex: 1, height: 32, fontSize: "var(--text-sm)", background: "var(--teal)", color: "var(--white)", boxShadow: "none" }}
                disabled={professionBusy}
                onClick={() => doChangeProfession(pendingProfession)}>
                {professionBusy ? t("adminProfession.saving") : t("adminProfession.confirm")}
              </button>
              <button className="btn btn-secondary"
                style={{ height: 32, fontSize: "var(--text-sm)", padding: "0 14px" }}
                disabled={professionBusy}
                onClick={() => { setPendingProfession(null); setProfessionErr(""); }}>
                {t("cancel")}
              </button>
            </div>
          )}
          {professionErr && <div className="form-error" style={{ marginTop: 0 }}>{professionErr}</div>}

          {/* Comp row — same grid as profession so labels align */}
          <div style={{ display: "grid", gridTemplateColumns: "minmax(120px, 140px) 1fr", gap: 12, alignItems: "center" }}>
            <span style={{ fontSize: 12, color: "var(--charcoal-xl)", fontWeight: 700 }}>
              {t("admin.compAccessLabel")}
            </span>
            <button
              className="btn"
              style={{
                height: 34, fontSize: "var(--text-sm)", padding: "0 14px", boxShadow: "none",
                background: account.compGranted ? "var(--green-bg)" : "var(--cream)",
                color: account.compGranted ? "var(--green)" : "var(--charcoal-md)",
                justifySelf: "start",
              }}
              disabled={compBusy}
              onClick={async () => {
                setCompBusy(true); setCompErr("");
                try {
                  await adminGrantComp(account.userId, !account.compGranted);
                  haptic.tap();
                  onAction?.();
                } catch (e) {
                  setCompErr(e.message || "Error");
                } finally {
                  setCompBusy(false);
                }
              }}>
              {compBusy ? "…" : account.compGranted ? t("admin.compRevoke") : t("admin.compGrant")}
            </button>
          </div>
          {compErr && <div className="form-error" style={{ marginTop: 0 }}>{compErr}</div>}

          {/* Destructive actions — visually grouped at the bottom of
              the panel so they read as "consequence-bearing" rather
              than "primary actions". Self-protection guards keep the
              admin from blocking/deleting their own account. */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 4 }}>
            <button className="btn"
              style={{
                height: 36, fontSize: "var(--text-sm)", boxShadow: "none",
                background: account.blocked ? "var(--green-bg)" : "var(--amber-bg)",
                color: account.blocked ? "var(--green)" : "var(--amber)",
                opacity: isSelf ? 0.5 : 1,
              }}
              disabled={isSelf}
              onClick={() => { setErr(""); haptic.warn(); setMode("confirmBlock"); }}>
              {account.blocked ? t("admin.accountUnblock") : t("admin.accountBlock")}
            </button>
            <button className="btn"
              style={{ height: 36, fontSize: "var(--text-sm)", boxShadow: "none", background: "var(--red-bg)", color: "var(--red)", opacity: isSelf ? 0.5 : 1, gap: 6 }}
              disabled={isSelf}
              onClick={() => { setErr(""); setDeleteConfirmText(""); haptic.warn(); setMode("confirmDelete"); }}>
              <IconTrash size={13} /> {t("admin.accountDelete")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
