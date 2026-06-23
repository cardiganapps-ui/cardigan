import { useState } from "react";
import { IconTrash, IconChevron, IconKey } from "../../../components/Icons";
import { useT } from "../../../i18n/index";
import { haptic } from "../../../utils/haptics";
import { PROFESSIONS } from "../../../data/constants";
import { useCardiganMain } from "../../../context/CardiganContext";
import {
  adminBlockUser,
  adminDeleteUser,
  adminUpdateProfession,
  adminGrantComp,
  adminRecoverEncryption,
} from "../../../hooks/useCardiganData";
import { useAdminUndoToast } from "./useAdminUndoToast";
import { AdminUndoToast } from "./AdminUndoToast";

/* ── UserActionsMenu ──
   The admin-action surface for User Detail. v2 changes:

     • Block / Unblock now fires immediately and surfaces an 8s undo
       toast ("Bloqueado · Deshacer") — replaces the two-tap inline-confirm
       flow. Reversal calls the same RPC the other way.
     • Comp grant / revoke gains the same undo-toast pattern.
     • Recuperar cifrado is a new menu item under "Más opciones" that
       calls /api/admin-recover-encryption and shows the recovered
       base64 master key in a copy-friendly dialog.
     • Delete keeps the typed-confirm dialog (the destructive path stays
       deliberate — undo can't bring a deleted user back).
*/
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- loosely-typed admin account row
type Row = any;

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- `compact` kept in the signature as documented API surface
export function UserActionsMenu({ account, currentAdminId, onViewAs, onAction, compact = false }: {
  account: Row;
  currentAdminId?: string | null;
  onViewAs?: (uid: string) => void;
  onAction?: (result?: Row) => void;
  compact?: boolean;
}) {
  const { t } = useT();
  const { setProfessionLocal } = useCardiganMain();
  const [mode, setMode] = useState<string>("default"); // default | confirmDelete | recoverShow
  const [moreOpen, setMoreOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [pendingProfession, setPendingProfession] = useState<string | null>(null);
  const [professionBusy, setProfessionBusy] = useState(false);
  const [professionErr, setProfessionErr] = useState("");
  const [compBusy, setCompBusy] = useState(false);
  const [compErr, setCompErr] = useState("");
  const [recoverBusy, setRecoverBusy] = useState(false);
  const [recoveredKey, setRecoveredKey] = useState("");
  const [recoverErr, setRecoverErr] = useState("");

  const { toast, show: showUndo, dismiss: dismissUndo, runUndo } = useAdminUndoToast();

  const userIdSafe = account.userId || "";
  const emailSafe = account.email || "";
  const isSelf = !!userIdSafe && userIdSafe === currentAdminId;
  const emailLabel = emailSafe || `ID: ${userIdSafe.slice(0, 8) || "?"}…`;
  const deleteConfirmMatches = emailSafe
    ? deleteConfirmText.trim().toLowerCase() === emailSafe.trim().toLowerCase()
    : false;

  const reset = () => { setMode("default"); setErr(""); setDeleteConfirmText(""); };

  const doDelete = async () => {
    setBusy(true); setErr("");
    try { await adminDeleteUser(account.userId); onAction?.({ deleted: true }); reset(); }
    catch (e) { setErr((e as Error).message || t("admin.actionError")); }
    finally { setBusy(false); }
  };

  const doChangeProfession = async (next: string | null) => {
    if (!next || next === account.profession) { setPendingProfession(null); return; }
    setProfessionBusy(true); setProfessionErr("");
    try {
      await adminUpdateProfession(account.userId, next);
      if (isSelf && setProfessionLocal) setProfessionLocal(next);
      haptic.tap();
      setPendingProfession(null);
      onAction?.();
    } catch (e) {
      setProfessionErr((e as Error).message || t("adminProfession.saveFailed"));
    } finally {
      setProfessionBusy(false);
    }
  };

  /* Fire-and-undo for block/unblock. The mutation happens immediately;
     the toast just exposes an 8s window to fire the reverse mutation. */
  const toggleBlock = async () => {
    const wasBlocked = !!account.blocked;
    setBusy(true); setErr("");
    try {
      await adminBlockUser(account.userId, !wasBlocked);
      haptic.tap();
      onAction?.();
      showUndo({
        message: wasBlocked ? "Desbloqueado · 8s para deshacer" : "Bloqueado · 8s para deshacer",
        onUndo: async () => {
          await adminBlockUser(account.userId, wasBlocked);
          onAction?.();
        },
      });
    } catch (e) {
      setErr((e as Error).message || t("admin.actionError"));
    } finally {
      setBusy(false);
    }
  };

  const toggleComp = async () => {
    const wasGranted = !!account.compGranted;
    setCompBusy(true); setCompErr("");
    try {
      await adminGrantComp(account.userId, !wasGranted);
      haptic.tap();
      onAction?.();
      showUndo({
        message: wasGranted ? "Comp revocada · 8s para deshacer" : "Comp otorgada · 8s para deshacer",
        onUndo: async () => {
          await adminGrantComp(account.userId, wasGranted);
          onAction?.();
        },
      });
    } catch (e) {
      setCompErr((e as Error).message || t("admin.actionError"));
    } finally {
      setCompBusy(false);
    }
  };

  const doRecoverEncryption = async () => {
    setRecoverBusy(true); setRecoverErr(""); setRecoveredKey("");
    try {
      const { masterKey } = await adminRecoverEncryption(account.userId);
      setRecoveredKey(masterKey || "");
      setMode("recoverShow");
      onAction?.();
    } catch (e) {
      setRecoverErr((e as Error).message || t("admin.actionError"));
    } finally {
      setRecoverBusy(false);
    }
  };

  if (mode === "recoverShow") {
    return (
      <div style={{ padding: "0 0 4px" }}>
        <div style={{
          background: "var(--admin-accent-soft)",
          borderRadius: "var(--radius)",
          padding: "12px 14px",
          marginBottom: 10,
        }}>
          <div style={{ fontFamily: "var(--font-d)", fontSize: 14, fontWeight: 800, color: "var(--admin-text)", marginBottom: 4 }}>
            Clave maestra recuperada
          </div>
          <div style={{ fontSize: 12.5, color: "var(--admin-text-meta)", lineHeight: 1.5, marginBottom: 8 }}>
            Envía esta clave a {emailLabel} fuera de línea (correo cifrado o Signal).
            El usuario la usará para restablecer su frase de paso.
          </div>
          <textarea
            readOnly
            value={recoveredKey}
            rows={3}
            style={{
              width: "100%", fontFamily: "var(--admin-mono)", fontSize: 11,
              padding: 10, border: "1px solid var(--admin-border)",
              borderRadius: 6, background: "var(--admin-surface)",
              color: "var(--admin-text)", resize: "none",
            }}
            onFocus={(e: React.FocusEvent<HTMLTextAreaElement>) => e.target.select()}
          />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => { setRecoveredKey(""); reset(); }}
          >
            Cerrar
          </button>
          <button
            type="button"
            className="btn"
            style={{ background: "var(--admin-accent)", color: "var(--admin-surface)", boxShadow: "none" }}
            onClick={async () => {
              try { await navigator.clipboard?.writeText(recoveredKey); haptic.tap(); }
              catch { /* clipboard blocked */ }
            }}
          >
            Copiar clave
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
        <div style={{ fontFamily: "var(--font-d)", fontSize: "var(--text-md)", fontWeight: 800, color: "var(--admin-text)", textAlign: "center", marginBottom: 6, letterSpacing: "-0.2px" }}>
          {t("admin.deleteAccountTitle", { email: emailLabel })}
        </div>
        <div style={{ fontSize: "var(--text-sm)", color: "var(--admin-text-meta)", lineHeight: 1.5, textAlign: "center", marginBottom: 12 }}>
          {t("admin.deleteAccountWarning")}
        </div>

        <div style={{ background: "var(--red-bg)", borderRadius: "var(--radius)", padding: "10px 14px", marginBottom: 10 }}>
          <div style={{ fontSize: "var(--text-xs)", fontWeight: 700, color: "var(--red)", marginBottom: 6 }}>
            {t("admin.deleteAccountLost")}
          </div>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: "var(--text-sm)", color: "var(--admin-text-meta)", lineHeight: 1.6 }}>
            <li>{t("admin.deleteAccountLostData")}</li>
            <li>{t("admin.deleteAccountLostFiles")}</li>
            <li>{t("admin.deleteAccountLostAuth", { email: emailLabel })}</li>
          </ul>
        </div>

        {!account.blocked && (
          <div style={{ background: "var(--admin-accent-soft)", borderRadius: "var(--radius)", padding: "10px 14px", marginBottom: 10 }}>
            <div style={{ fontSize: "var(--text-xs)", fontWeight: 700, color: "var(--admin-accent)", marginBottom: 4 }}>
              {t("admin.deleteAccountAlternativeTitle")}
            </div>
            <div style={{ fontSize: "var(--text-sm)", color: "var(--admin-text-meta)", lineHeight: 1.5, marginBottom: 10 }}>
              {t("admin.deleteAccountAlternativeBody")}
            </div>
            <button type="button"
              onClick={() => { setDeleteConfirmText(""); setErr(""); reset(); toggleBlock(); }}
              className="btn btn-secondary" style={{ width: "100%", height: 36, fontSize: "var(--text-sm)" }}>
              {t("admin.deleteAccountAlternativeCta")}
            </button>
          </div>
        )}

        <div className="input-group">
          <label className="input-label">{t("admin.deleteAccountTypeToConfirm", { email: emailLabel })}</label>
          <input className="input"
            value={deleteConfirmText}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDeleteConfirmText(e.target.value)}
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
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <button className="btn"
          style={{ flex: "1 1 160px", height: 36, fontSize: "var(--text-sm)", background: "var(--admin-accent)", color: "var(--admin-surface)", boxShadow: "none", minWidth: 0 }}
          onClick={() => onViewAs?.(account.userId)}>
          {t("admin.view")}
        </button>
        <button type="button"
          aria-expanded={moreOpen}
          onClick={() => setMoreOpen((v) => !v)}
          style={{
            height: 36, padding: "0 14px", fontSize: "var(--text-sm)", fontWeight: 600,
            display: "inline-flex", alignItems: "center", gap: 6,
            background: "var(--admin-surface)", border: "1px solid var(--admin-border)",
            borderRadius: "var(--radius-pill)", color: "var(--admin-text-meta)",
            cursor: "pointer", fontFamily: "inherit",
            transition: "background-color var(--dur-fast) ease, border-color var(--dur-fast) ease, color var(--dur-fast) ease",
          }}>
          {t("admin.moreOptions")}
          <span aria-hidden style={{ display: "inline-flex", transform: moreOpen ? "rotate(90deg)" : "rotate(0deg)", transition: "transform var(--dur-fast) ease" }}>
            <IconChevron size={12} />
          </span>
        </button>
      </div>

      {moreOpen && (
        <div style={{
          marginTop: 14, paddingTop: 14,
          borderTop: "1px solid var(--admin-border)",
          display: "flex", flexDirection: "column", gap: 12,
          animation: "fadeIn 0.18s ease",
        }}>
          {/* Profession row */}
          <div style={{ display: "grid", gridTemplateColumns: "minmax(120px, 140px) 1fr", gap: 12, alignItems: "center" }}>
            <span style={{ fontSize: 12, color: "var(--admin-text-faint)", fontWeight: 700 }}>
              {t("adminProfession.label")}
            </span>
            <select
              className="input"
              value={pendingProfession ?? account.profession ?? "psychologist"}
              disabled={professionBusy}
              onChange={(e: React.ChangeEvent<HTMLSelectElement>) => {
                setProfessionErr("");
                setPendingProfession(e.target.value === account.profession ? null : e.target.value);
              }}
              style={{ height: 34, fontSize: "var(--text-sm)", padding: "0 10px" }}>
              {PROFESSIONS.map((p: Row) => (
                <option key={p} value={p}>{t(`onboarding.professions.${p}.label`)}</option>
              ))}
            </select>
          </div>
          {pendingProfession && (
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn"
                style={{ flex: 1, height: 32, fontSize: "var(--text-sm)", background: "var(--admin-accent)", color: "var(--admin-surface)", boxShadow: "none" }}
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

          {/* Comp row — fire-and-undo */}
          <div style={{ display: "grid", gridTemplateColumns: "minmax(120px, 140px) 1fr", gap: 12, alignItems: "center" }}>
            <span style={{ fontSize: 12, color: "var(--admin-text-faint)", fontWeight: 700 }}>
              {t("admin.compAccessLabel")}
            </span>
            <button
              className="btn"
              style={{
                height: 34, fontSize: "var(--text-sm)", padding: "0 14px", boxShadow: "none",
                background: account.compGranted ? "rgba(47, 143, 92, 0.10)" : "var(--admin-surface-2)",
                color: account.compGranted ? "var(--admin-success)" : "var(--admin-text-meta)",
                border: "1px solid var(--admin-border)",
                justifySelf: "start",
              }}
              disabled={compBusy}
              onClick={toggleComp}>
              {compBusy ? "…" : account.compGranted ? t("admin.compRevoke") : t("admin.compGrant")}
            </button>
          </div>
          {compErr && <div className="form-error" style={{ marginTop: 0 }}>{compErr}</div>}

          {/* Destructive actions row. Block now uses fire-and-undo (no
              two-tap confirm); Delete keeps the typed-confirm dialog. */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 4 }}>
            <button className="btn"
              style={{
                height: 36, fontSize: "var(--text-sm)", boxShadow: "none",
                background: account.blocked ? "rgba(47, 143, 92, 0.10)" : "rgba(180, 122, 20, 0.10)",
                color: account.blocked ? "var(--admin-success)" : "var(--admin-warn)",
                border: "1px solid var(--admin-border)",
                opacity: isSelf || busy ? 0.5 : 1,
              }}
              disabled={isSelf || busy}
              onClick={toggleBlock}>
              {busy ? "…" : (account.blocked ? t("admin.accountUnblock") : t("admin.accountBlock"))}
            </button>
            <button className="btn"
              style={{
                height: 36, fontSize: "var(--text-sm)", boxShadow: "none",
                background: "rgba(197, 68, 59, 0.10)", color: "var(--admin-danger)",
                border: "1px solid var(--admin-border)",
                opacity: isSelf ? 0.5 : 1, gap: 6,
              }}
              disabled={isSelf}
              onClick={() => { setErr(""); setDeleteConfirmText(""); haptic.warn(); setMode("confirmDelete"); }}>
              <IconTrash size={13} /> {t("admin.accountDelete")}
            </button>
          </div>
          {err && <div className="form-error" style={{ marginTop: 0 }}>{err}</div>}

          {/* Recuperar cifrado — surfaces the previously-unexposed
              /api/admin-recover-encryption endpoint. Hidden as a
              tertiary action so an admin only finds it when they need
              it. Always available regardless of self/blocked state —
              recovery is read-only on the user's wrapper. */}
          <button type="button"
            onClick={doRecoverEncryption}
            disabled={recoverBusy}
            style={{
              alignSelf: "flex-start",
              display: "inline-flex", alignItems: "center", gap: 8,
              padding: "6px 12px", fontSize: 12.5, fontWeight: 600,
              background: "transparent", border: "1px dashed var(--admin-border)",
              borderRadius: 999, color: "var(--admin-text-meta)",
              cursor: recoverBusy ? "default" : "pointer", marginTop: 4,
            }}>
            <IconKey size={13} />
            {recoverBusy ? "Recuperando…" : "Recuperar cifrado"}
          </button>
          {recoverErr && <div className="form-error" style={{ marginTop: 0 }}>{recoverErr}</div>}
        </div>
      )}

      <AdminUndoToast toast={toast} onDismiss={dismissUndo} runUndo={runUndo} />
    </div>
  );
}
