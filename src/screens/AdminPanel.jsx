import { useState, useEffect, useCallback } from "react";
import { fetchAllAccounts, fetchBugReports, deleteBugReport, archiveBugReports, adminBlockUser, adminDeleteUser, adminUpdateProfession, fetchAdminAnalytics } from "../hooks/useCardiganData";
import { IconX, IconTrash, IconDownload, IconCheck } from "../components/Icons";
import { Avatar } from "../components/Avatar";
import { useT } from "../i18n/index";
import { PROFESSIONS } from "../data/constants";

function relativeTime(dateStr) {
  if (!dateStr) return "";
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "ahora";
  if (mins < 60) return `hace ${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `hace ${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return "ayer";
  if (days < 7) return `hace ${days}d`;
  return new Date(dateStr).toLocaleDateString("es-MX", { day: "numeric", month: "short" });
}

/* ── Account row ──
   Tapping the row opens an inline "Acciones" strip that lets the admin
   pick between Ver como usuario / Bloquear / Eliminar. Block and Delete
   each have their own strong confirmation screens below the row. */
function AccountRow({ account, currentAdminId, onViewAs, onAction }) {
  const { t } = useT();
  const [mode, setMode] = useState("collapsed"); // collapsed | actions | confirmBlock | confirmDelete
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [professionBusy, setProfessionBusy] = useState(false);
  const [professionErr, setProfessionErr] = useState("");
  const [pendingProfession, setPendingProfession] = useState(null);

  const isSelf = account.userId === currentAdminId;
  const emailLabel = account.email || `ID: ${account.userId.slice(0, 8)}…`;
  const deleteConfirmMatches = account.email
    ? deleteConfirmText.trim().toLowerCase() === account.email.trim().toLowerCase()
    : false;

  const reset = () => { setMode("collapsed"); setErr(""); setDeleteConfirmText(""); };

  const doBlock = async (block) => {
    setBusy(true); setErr("");
    try { await adminBlockUser(account.userId, block); onAction(); reset(); }
    catch (e) { setErr(e.message || t("admin.actionError")); }
    finally { setBusy(false); }
  };

  const doDelete = async () => {
    setBusy(true); setErr("");
    try { await adminDeleteUser(account.userId); onAction(); reset(); }
    catch (e) { setErr(e.message || t("admin.actionError")); }
    finally { setBusy(false); }
  };

  const doChangeProfession = async (next) => {
    if (!next || next === account.profession) {
      setPendingProfession(null);
      return;
    }
    setProfessionBusy(true); setProfessionErr("");
    try {
      await adminUpdateProfession(account.userId, next);
      setPendingProfession(null);
      onAction();
    } catch (e) {
      setProfessionErr(e.message || t("adminProfession.saveFailed"));
    } finally {
      setProfessionBusy(false);
    }
  };

  return (
    <div style={{ borderBottom:"1px solid var(--border-lt)" }}>
      {/* Summary row */}
      <div className="row-item"
        style={{ cursor:"pointer", borderBottom:"none" }}
        onClick={() => setMode(m => m === "collapsed" ? "actions" : "collapsed")}>
        <Avatar initials={(account.fullName || account.email || "?").charAt(0).toUpperCase()}
          color={account.blocked ? "var(--charcoal-xl)" : "var(--teal)"} size="md" />
        <div className="row-content">
          <div className="row-title" style={{ display:"flex", alignItems:"center", gap:6 }}>
            {account.fullName || t("admin.noName")}
            {account.blocked && <span className="badge badge-red">{t("admin.accountStatusBlocked")}</span>}
          </div>
          <div className="row-sub">
            {emailLabel} · {account.patientCount} {t("nav.patients").toLowerCase()}
            {account.profession && (
              <> · <span style={{ color: "var(--teal-dark)", fontWeight: 700 }}>
                {t(`onboarding.professions.${account.profession}.label`)}
              </span></>
            )}
          </div>
        </div>
        <span className="row-chevron" style={{ transform: mode !== "collapsed" ? "rotate(90deg)" : undefined, transition:"transform 0.4s" }}>›</span>
      </div>

      {/* Actions strip */}
      {mode === "actions" && (
        <div style={{ padding:"0 16px 12px", display:"flex", flexDirection:"column", gap:8 }}>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:8 }}>
            <button className="btn" style={{ height:36, fontSize:"var(--text-sm)", background:"var(--teal-pale)", color:"var(--teal-dark)", boxShadow:"none" }}
              onClick={(e) => { e.stopPropagation(); onViewAs(account.userId); }}>
              {t("admin.view")}
            </button>
            <button className="btn"
              style={{ height:36, fontSize:"var(--text-sm)", boxShadow:"none",
                background: account.blocked ? "var(--green-bg)" : "var(--amber-bg)",
                color: account.blocked ? "var(--green)" : "var(--amber)",
                opacity: isSelf ? 0.5 : 1 }}
              disabled={isSelf}
              onClick={(e) => { e.stopPropagation(); setErr(""); setMode("confirmBlock"); }}>
              {account.blocked ? t("admin.accountUnblock") : t("admin.accountBlock")}
            </button>
            <button className="btn"
              style={{ height:36, fontSize:"var(--text-sm)", boxShadow:"none", background:"var(--red-bg)", color:"var(--red)", opacity: isSelf ? 0.5 : 1 }}
              disabled={isSelf}
              onClick={(e) => { e.stopPropagation(); setErr(""); setDeleteConfirmText(""); setMode("confirmDelete"); }}>
              {t("admin.accountDelete")}
            </button>
          </div>
          {/* Inline profession picker — admin-only path to change a
              user's profession after sign-up. Two-step: pick a value
              from the dropdown, then confirm to save. Prevents an
              accidental drag-tap from rewriting the user's vocabulary
              + theme + templates without a chance to back out. */}
          <div onClick={(e) => e.stopPropagation()} style={{ display:"flex", alignItems:"center", gap:8 }}>
            <span style={{ fontSize:"var(--text-xs)", color:"var(--charcoal-xl)", fontWeight:700 }}>
              {t("adminProfession.label")}:
            </span>
            <select
              className="input"
              value={pendingProfession ?? account.profession ?? "psychologist"}
              disabled={professionBusy}
              onChange={(e) => {
                setProfessionErr("");
                setPendingProfession(e.target.value === account.profession ? null : e.target.value);
              }}
              style={{ flex:1, height:32, fontSize:"var(--text-sm)", padding:"0 8px" }}>
              {PROFESSIONS.map((p) => (
                <option key={p} value={p}>{t(`onboarding.professions.${p}.label`)}</option>
              ))}
            </select>
          </div>
          {pendingProfession && (
            <div style={{ display:"flex", gap:6, alignItems:"center" }}>
              <button
                className="btn"
                style={{ flex:1, height:32, fontSize:"var(--text-sm)", background:"var(--teal)", color:"var(--white)", boxShadow:"none" }}
                disabled={professionBusy}
                onClick={(e) => { e.stopPropagation(); doChangeProfession(pendingProfession); }}>
                {professionBusy ? t("adminProfession.saving") : t("adminProfession.confirm")}
              </button>
              <button
                className="btn btn-secondary"
                style={{ height:32, fontSize:"var(--text-sm)", padding:"0 12px" }}
                disabled={professionBusy}
                onClick={(e) => { e.stopPropagation(); setPendingProfession(null); setProfessionErr(""); }}>
                {t("cancel")}
              </button>
            </div>
          )}
          {professionErr && <div className="form-error" style={{ marginTop:0 }}>{professionErr}</div>}
        </div>
      )}

      {/* Block / Unblock confirmation */}
      {mode === "confirmBlock" && (
        <div style={{ padding:"0 16px 14px" }}>
          <div style={{ background: account.blocked ? "var(--green-bg)" : "var(--amber-bg)", borderRadius:"var(--radius)", padding:"12px 14px", marginBottom:10 }}>
            <div style={{ fontFamily:"var(--font-d)", fontSize:"var(--text-md)", fontWeight:800, color:"var(--charcoal)", marginBottom:4 }}>
              {account.blocked
                ? t("admin.unblockTitle", { email: emailLabel })
                : t("admin.blockTitle", { email: emailLabel })}
            </div>
            <div style={{ fontSize:"var(--text-sm)", color:"var(--charcoal-md)", lineHeight:1.5 }}>
              {account.blocked ? t("admin.unblockBody") : t("admin.blockBody")}
            </div>
          </div>
          {err && <div className="form-error">{err}</div>}
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
            <button className="btn btn-secondary" onClick={reset} disabled={busy}>{t("cancel")}</button>
            <button className="btn"
              style={{ background: account.blocked ? "var(--green)" : "var(--amber)", color:"var(--white)", boxShadow:"none" }}
              onClick={() => doBlock(!account.blocked)} disabled={busy}>
              {busy ? t("admin.processing") : (account.blocked ? t("admin.unblockConfirm") : t("admin.blockConfirm"))}
            </button>
          </div>
        </div>
      )}

      {/* Delete confirmation — strongest pattern */}
      {mode === "confirmDelete" && (
        <div style={{ padding:"0 16px 14px" }}>
          {/* Red warning */}
          <div style={{ textAlign:"center", margin:"6px 0 10px" }}>
            <div style={{ width:52, height:52, borderRadius:"50%", background:"var(--red-bg)", color:"var(--red)", display:"inline-flex", alignItems:"center", justifyContent:"center" }}>
              <IconTrash size={22} />
            </div>
          </div>
          <div style={{ fontFamily:"var(--font-d)", fontSize:"var(--text-md)", fontWeight:800, color:"var(--charcoal)", textAlign:"center", marginBottom:6, letterSpacing:"-0.2px" }}>
            {t("admin.deleteAccountTitle", { email: emailLabel })}
          </div>
          <div style={{ fontSize:"var(--text-sm)", color:"var(--charcoal-md)", lineHeight:1.5, textAlign:"center", marginBottom:12 }}>
            {t("admin.deleteAccountWarning")}
          </div>

          {/* What will be lost */}
          <div style={{ background:"var(--red-bg)", borderRadius:"var(--radius)", padding:"10px 14px", marginBottom:10 }}>
            <div style={{ fontSize:"var(--text-xs)", fontWeight:700, color:"var(--red)", marginBottom:6 }}>
              {t("admin.deleteAccountLost")}
            </div>
            <ul style={{ margin:0, paddingLeft:18, fontSize:"var(--text-sm)", color:"var(--charcoal-md)", lineHeight:1.6 }}>
              <li>{t("admin.deleteAccountLostData")}</li>
              <li>{t("admin.deleteAccountLostFiles")}</li>
              <li>{t("admin.deleteAccountLostAuth", { email: emailLabel })}</li>
            </ul>
          </div>

          {/* Alternative: block */}
          {!account.blocked && (
            <div style={{ background:"var(--teal-pale)", borderRadius:"var(--radius)", padding:"10px 14px", marginBottom:10 }}>
              <div style={{ fontSize:"var(--text-xs)", fontWeight:700, color:"var(--teal-dark)", marginBottom:4 }}>
                {t("admin.deleteAccountAlternativeTitle")}
              </div>
              <div style={{ fontSize:"var(--text-sm)", color:"var(--charcoal-md)", lineHeight:1.5, marginBottom:10 }}>
                {t("admin.deleteAccountAlternativeBody")}
              </div>
              <button type="button"
                onClick={() => { setDeleteConfirmText(""); setErr(""); setMode("confirmBlock"); }}
                className="btn btn-secondary" style={{ width:"100%", height:36, fontSize:"var(--text-sm)" }}>
                {t("admin.deleteAccountAlternativeCta")}
              </button>
            </div>
          )}

          {/* Type-to-confirm email */}
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

          <button className="btn btn-danger" style={{ marginBottom:8 }}
            onClick={doDelete}
            disabled={busy || !deleteConfirmMatches || !account.email}>
            {busy ? t("admin.processing") : t("admin.deleteAccountConfirm")}
          </button>
          <button className="btn btn-secondary w-full" onClick={reset} disabled={busy}>
            {t("cancel")}
          </button>
        </div>
      )}
    </div>
  );
}

// Split "Ana María López Pérez" → { first: "ana maría", last: "lópez pérez" }.
// If the name has only one token, treat it as the first name and leave
// last blank so accounts with no surname still sort sensibly.
function nameParts(fullName) {
  const tokens = (fullName || "").trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return { first: "", last: "" };
  if (tokens.length === 1) return { first: tokens[0], last: "" };
  return { first: tokens[0], last: tokens.slice(1).join(" ") };
}

function compareAccounts(a, b) {
  const an = nameParts(a.fullName);
  const bn = nameParts(b.fullName);
  const cmp = (x, y) => x.localeCompare(y, "es", { sensitivity: "base" });
  return cmp(an.first, bn.first)
      || cmp(an.last, bn.last)
      || cmp((a.email || "").toLowerCase(), (b.email || "").toLowerCase());
}

function AccountsTab({ onViewAs, currentAdminId }) {
  const { t } = useT();
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    setLoading(true);
    fetchAllAccounts()
      .then(a => { setAccounts([...a].sort(compareAccounts)); setError(""); setLoading(false); })
      .catch(e => { setError(e.message || t("admin.loadError")); setLoading(false); });
  }, [t]);

  // setLoading(true) inside load() is a no-op on mount since loading
  // initialises to true, so the cascade the rule warns about doesn't
  // actually happen here.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  if (loading) return <div style={{ textAlign:"center", padding:40, color:"var(--charcoal-xl)", fontSize:"var(--text-sm)" }}>{t("admin.loadingAccounts")}</div>;
  if (error) return <div style={{ textAlign:"center", padding:40, color:"var(--red)", fontSize:"var(--text-sm)" }}>{error}</div>;
  if (accounts.length === 0) return <div style={{ textAlign:"center", padding:40, color:"var(--charcoal-xl)", fontSize:"var(--text-sm)" }}>{t("admin.noAccounts")}</div>;

  return (
    <>
      <div style={{ fontSize:"var(--text-xs)", color:"var(--charcoal-xl)", marginBottom:8 }}>
        {t("admin.accounts", { count: accounts.length })}
      </div>
      <div className="card">
        {accounts.map(a => (
          <AccountRow key={a.userId} account={a} currentAdminId={currentAdminId}
            onViewAs={onViewAs} onAction={load} />
        ))}
      </div>
    </>
  );
}

function BugReportRow({ report, onDelete }) {
  const { t } = useT();
  const [expanded, setExpanded] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    setDeleting(true);
    try { await onDelete(report.id); }
    finally { setDeleting(false); }
  };

  const logsText = typeof report.logs === "string"
    ? report.logs
    : Array.isArray(report.logs)
      ? report.logs.map(l => typeof l === "string" ? l : JSON.stringify(l)).join("\n")
      : report.logs ? JSON.stringify(report.logs, null, 2) : "";

  return (
    <div className="card" style={{ padding:"12px 14px", marginBottom:10 }}>
      <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", gap:8, marginBottom:6 }}>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontSize:13, fontWeight:700, color:"var(--charcoal)", marginBottom:2, wordBreak:"break-word" }}>
            {report.description || <span style={{ color:"var(--charcoal-xl)", fontWeight:500, fontStyle:"italic" }}>{t("admin.bugNoDescription")}</span>}
          </div>
          <div style={{ fontSize:11, color:"var(--charcoal-xl)", display:"flex", gap:6, alignItems:"center", flexWrap:"wrap" }}>
            <span>{relativeTime(report.created_at)}</span>
            <span>·</span>
            <span style={{ wordBreak:"break-all" }}>{report.user_email || t("admin.bugAnonymous")}</span>
            {report.screen && (<>
              <span>·</span>
              <span style={{ background:"var(--teal-pale)", color:"var(--teal-dark)", padding:"1px 7px", borderRadius:"var(--radius-pill)", fontWeight:700 }}>{report.screen}</span>
            </>)}
          </div>
        </div>
        {confirmDel ? (
          <div style={{ display:"flex", gap:4, flexShrink:0 }}>
            <button onClick={handleDelete} disabled={deleting}
              style={{ padding:"4px 10px", fontSize:"var(--text-xs)", fontWeight:700, color:"var(--white)", background:"var(--red)", border:"none", borderRadius:"var(--radius-pill)", cursor:"pointer", fontFamily:"var(--font)", minHeight:28 }}>
              {deleting ? "..." : t("delete")}
            </button>
            <button onClick={() => setConfirmDel(false)}
              style={{ padding:"4px 10px", fontSize:11, fontWeight:600, color:"var(--charcoal-md)", background:"var(--cream)", border:"none", borderRadius:"var(--radius-pill)", cursor:"pointer", fontFamily:"var(--font)", minHeight:28 }}>
              {t("cancel")}
            </button>
          </div>
        ) : (
          <button onClick={() => setConfirmDel(true)} aria-label={t("delete")}
            style={{ width:30, height:30, minHeight:30, borderRadius:"50%", background:"var(--red-bg)", color:"var(--red)", border:"none", display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer", flexShrink:0, padding:0 }}>
            <IconTrash size={14} />
          </button>
        )}
      </div>

      <button onClick={() => setExpanded(e => !e)}
        style={{ fontSize:11, fontWeight:600, color:"var(--teal-dark)", background:"none", border:"none", cursor:"pointer", padding:"2px 0", fontFamily:"var(--font)", minHeight:24 }}>
        {expanded ? t("admin.bugHideDetails") : t("admin.bugShowDetails")} {expanded ? "▴" : "▾"}
      </button>

      {expanded && (
        <div style={{ marginTop:8, paddingTop:8, borderTop:"1px solid var(--border-lt)", fontSize:11, color:"var(--charcoal-md)" }}>
          {report.user_agent && (
            <div style={{ marginBottom:6 }}>
              <div style={{ fontSize:10, fontWeight:700, textTransform:"uppercase", letterSpacing:"0.05em", color:"var(--charcoal-xl)", marginBottom:2 }}>{t("admin.bugUserAgent")}</div>
              <div style={{ wordBreak:"break-all", fontFamily:"monospace", fontSize:10, color:"var(--charcoal-lt)" }}>{report.user_agent}</div>
            </div>
          )}
          {logsText && (
            <div>
              <div style={{ fontSize:10, fontWeight:700, textTransform:"uppercase", letterSpacing:"0.05em", color:"var(--charcoal-xl)", marginBottom:2 }}>{t("admin.bugLogs")}</div>
              <pre style={{ whiteSpace:"pre-wrap", wordBreak:"break-word", fontFamily:"monospace", fontSize:10, color:"var(--charcoal-lt)", background:"var(--cream)", padding:"6px 8px", borderRadius:"var(--radius-sm)", maxHeight:240, overflowY:"auto", margin:0 }}>{logsText}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function formatReportText(r) {
  const date = r.created_at ? new Date(r.created_at).toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short" }) : "—";
  const logs = Array.isArray(r.logs)
    ? r.logs.map(l => typeof l === "string" ? l : `[${l.level}] ${l.timestamp || ""} ${l.message}`).join("\n")
    : typeof r.logs === "string" ? r.logs : r.logs ? JSON.stringify(r.logs, null, 2) : "";

  let text = `## Bug Report — ${date}\n`;
  text += `User: ${r.user_email || "Anónimo"}\n`;
  text += `Screen: ${r.screen || "—"}\n`;
  text += `Description: ${r.description || "(sin descripción)"}\n`;
  if (r.user_agent) text += `User-Agent: ${r.user_agent}\n`;
  if (logs) text += `\nLogs:\n${logs}\n`;
  return text;
}

function downloadBugReports(reports) {
  const text = reports.map(formatReportText).join("\n---\n\n");
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `bug-reports-${new Date().toISOString().slice(0, 10)}.txt`;
  a.click();
  URL.revokeObjectURL(url);
}

function BugsTab() {
  const { t } = useT();
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    fetchBugReports({ archived: showArchived })
      .then(r => { setReports(r); setError(""); setLoading(false); })
      .catch(e => { setError(e.message || t("admin.bugsLoadError")); setLoading(false); });
  }, [t, showArchived]);

  useEffect(() => { load(); }, [load]);

  const handleDelete = async (id) => {
    await deleteBugReport(id);
    setReports(prev => prev.filter(r => r.id !== id));
  };

  const handleArchiveAll = async () => {
    setArchiving(true);
    setError("");
    try {
      const ids = reports.map(r => r.id);
      await archiveBugReports(ids);
      // Re-fetch to confirm archive persisted
      const fresh = await fetchBugReports({ archived: false });
      const stillPending = fresh.filter(r => ids.includes(r.id));
      if (stillPending.length > 0) throw new Error(t("admin.bugsArchiveFailed"));
      setReports(fresh);
      setConfirmArchive(false);
    } catch (e) {
      setError(e.message || "Error");
    } finally {
      setArchiving(false);
    }
  };

  if (loading) return <div style={{ textAlign:"center", padding:40, color:"var(--charcoal-xl)", fontSize:13 }}>{t("admin.bugsLoading")}</div>;

  return (
    <>
      {/* Toggle active / archived */}
      <div style={{ display:"flex", background:"var(--cream)", borderRadius:"var(--radius-pill)", padding:3, gap:2, marginBottom:12 }}>
        {[{ k: false, l: t("admin.bugsActive") }, { k: true, l: t("admin.bugsArchived") }].map(tb => (
          <button key={String(tb.k)} onClick={() => { setShowArchived(tb.k); setConfirmArchive(false); }}
            style={{
              flex:1, padding:"5px 10px", fontSize:11, fontWeight:700,
              borderRadius:"var(--radius-pill)", border:"none", cursor:"pointer",
              fontFamily:"var(--font)", minHeight:28,
              background: showArchived === tb.k ? "var(--white)" : "transparent",
              color: showArchived === tb.k ? "var(--charcoal)" : "var(--charcoal-xl)",
              boxShadow: showArchived === tb.k ? "var(--shadow-sm)" : "none",
              transition: "all 0.4s",
            }}>
            {tb.l}
          </button>
        ))}
      </div>

      {error && (
        <div style={{ textAlign:"center", padding:"12px 14px", marginBottom:10, background:"var(--red-bg)", borderRadius:"var(--radius-sm)", color:"var(--red)", fontSize:13 }}>
          <div style={{ marginBottom:8 }}>{error}</div>
          <button onClick={() => { setError(""); load(); }}
            style={{ fontSize:"var(--text-xs)", fontWeight:700, color:"var(--white)", background:"var(--red)", border:"none", borderRadius:"var(--radius-pill)", padding:"4px 14px", cursor:"pointer", fontFamily:"var(--font)", minHeight:28 }}>
            {t("retry")}
          </button>
        </div>
      )}

      {reports.length === 0 ? (
        !error && <div style={{ textAlign:"center", padding:40, color:"var(--charcoal-xl)", fontSize:13 }}>
          {showArchived ? t("admin.bugsArchivedEmpty") : t("admin.bugsEmpty")}
        </div>
      ) : (
        <>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:8, gap:6 }}>
            <div style={{ fontSize:11, color:"var(--charcoal-xl)" }}>
              {t("admin.bugsCount", { count: reports.length })}
            </div>
            <div style={{ display:"flex", gap:6 }}>
              <button onClick={() => downloadBugReports(reports)}
                style={{ display:"flex", alignItems:"center", gap:4, padding:"4px 10px", fontSize:11, fontWeight:700, color:"var(--teal-dark)", background:"var(--teal-pale)", border:"none", borderRadius:"var(--radius-pill)", cursor:"pointer", fontFamily:"var(--font)", minHeight:28 }}>
                <IconDownload size={13} /> .txt
              </button>
              {!showArchived && (
                confirmArchive ? (
                  <div style={{ display:"flex", gap:4 }}>
                    <button onClick={handleArchiveAll} disabled={archiving}
                      style={{ padding:"4px 10px", fontSize:"var(--text-xs)", fontWeight:700, color:"var(--white)", background:"var(--green)", border:"none", borderRadius:"var(--radius-pill)", cursor:"pointer", fontFamily:"var(--font)", minHeight:28 }}>
                      {archiving ? "..." : t("admin.bugsArchiveConfirm")}
                    </button>
                    <button onClick={() => setConfirmArchive(false)}
                      style={{ padding:"4px 10px", fontSize:11, fontWeight:600, color:"var(--charcoal-md)", background:"var(--cream)", border:"none", borderRadius:"var(--radius-pill)", cursor:"pointer", fontFamily:"var(--font)", minHeight:28 }}>
                      {t("cancel")}
                    </button>
                  </div>
                ) : (
                  <button onClick={() => setConfirmArchive(true)}
                    style={{ display:"flex", alignItems:"center", gap:4, padding:"4px 10px", fontSize:11, fontWeight:700, color:"var(--green)", background:"var(--green-bg)", border:"none", borderRadius:"var(--radius-pill)", cursor:"pointer", fontFamily:"var(--font)", minHeight:28 }}>
                    <IconCheck size={13} /> {t("admin.bugsArchiveAll")}
                  </button>
                )
              )}
            </div>
          </div>
          {reports.map(r => <BugReportRow key={r.id} report={r} onDelete={handleDelete} />)}
        </>
      )}
    </>
  );
}

/* ── Métricas tab ──
   Operator-facing analytics: how many users we have, how many are
   active, how much money the platform has tracked, plus a 30-day
   daily activity series. All numbers come from two SQL functions in
   migration 016, both of which gate on is_admin() server-side. */

function StatCard({ label, value, sub }) {
  return (
    <div style={{ background:"var(--cream)", borderRadius:"var(--radius)", padding:"12px 14px" }}>
      <div style={{ fontSize:11, fontWeight:700, textTransform:"uppercase", letterSpacing:"0.05em", color:"var(--charcoal-xl)", marginBottom:4 }}>{label}</div>
      <div style={{ fontFamily:"var(--font-d)", fontSize:22, fontWeight:800, color:"var(--charcoal)", lineHeight:1.1 }}>{value}</div>
      {sub && <div style={{ fontSize:11, color:"var(--charcoal-xl)", marginTop:4 }}>{sub}</div>}
    </div>
  );
}

function formatMoney(n) {
  return `$${(Number(n) || 0).toLocaleString("es-MX", { maximumFractionDigits: 0 })}`;
}

function DailyBars({ daily, accessor, label, color = "var(--teal)" }) {
  // Pure-CSS bar chart. Each bar's height is value/max. A row of zero-
  // height bars renders as a flat baseline so empty days still take
  // space — visually communicating "no activity" rather than skipping.
  const values = daily.map(accessor);
  const max = Math.max(1, ...values);
  return (
    <div style={{ background:"var(--cream)", borderRadius:"var(--radius)", padding:"12px 14px" }}>
      <div style={{ display:"flex", alignItems:"baseline", justifyContent:"space-between", marginBottom:10 }}>
        <div style={{ fontSize:11, fontWeight:700, textTransform:"uppercase", letterSpacing:"0.05em", color:"var(--charcoal-xl)" }}>{label}</div>
        <div style={{ fontSize:11, color:"var(--charcoal-xl)" }}>max {max}</div>
      </div>
      <div style={{ display:"flex", alignItems:"flex-end", gap:2, height:60 }}>
        {daily.map((row) => {
          const v = accessor(row);
          const pct = max > 0 ? (v / max) * 100 : 0;
          return (
            <div
              key={row.day}
              title={`${row.day}: ${v}`}
              style={{
                flex:1,
                minHeight: v > 0 ? 2 : 1,
                height: `${Math.max(pct, v > 0 ? 4 : 1)}%`,
                background: v > 0 ? color : "var(--border-lt)",
                borderRadius:2,
                transition: "height 0.3s",
              }}
            />
          );
        })}
      </div>
      <div style={{ display:"flex", justifyContent:"space-between", marginTop:6, fontSize:10, color:"var(--charcoal-xl)" }}>
        <span>{daily[0]?.day || ""}</span>
        <span>{daily[daily.length - 1]?.day || ""}</span>
      </div>
    </div>
  );
}

function MetricsTab() {
  const { t } = useT();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    setLoading(true);
    fetchAdminAnalytics({ days: 30 })
      .then((d) => { setData(d); setError(""); setLoading(false); })
      .catch((e) => { setError(e.message || t("admin.metricsLoadError")); setLoading(false); });
  }, [t]);

  // setLoading(true) inside load() is a no-op on mount since loading
  // initialises to true; matches the AccountsTab / BugsTab pattern.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  if (loading) {
    return <div style={{ textAlign:"center", padding:40, color:"var(--charcoal-xl)", fontSize:13 }}>{t("admin.metricsLoading")}</div>;
  }
  if (error) {
    return (
      <div style={{ textAlign:"center", padding:"12px 14px", background:"var(--red-bg)", borderRadius:"var(--radius-sm)", color:"var(--red)", fontSize:13 }}>
        <div style={{ marginBottom:8 }}>{error}</div>
        <button onClick={load}
          style={{ fontSize:"var(--text-xs)", fontWeight:700, color:"var(--white)", background:"var(--red)", border:"none", borderRadius:"var(--radius-pill)", padding:"4px 14px", cursor:"pointer", fontFamily:"var(--font)", minHeight:28 }}>
          {t("retry")}
        </button>
      </div>
    );
  }
  const ov = data?.overview || {};
  const daily = data?.daily || [];

  return (
    <>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginBottom:12 }}>
        <StatCard
          label={t("admin.metricsUsers")}
          value={ov.users_total ?? 0}
          sub={t("admin.metricsUsersSub", { active: ov.users_active_30d ?? 0, blocked: ov.users_blocked ?? 0 })}
        />
        <StatCard
          label={t("admin.metricsSignups30d")}
          value={ov.users_signups_30d ?? 0}
          sub={t("admin.metricsSignupsSub")}
        />
        <StatCard
          label={t("admin.metricsMoney")}
          value={formatMoney(ov.money_tracked_total)}
          sub={t("admin.metricsMoneySub", { v: formatMoney(ov.money_tracked_30d) })}
        />
        <StatCard
          label={t("admin.metricsPatients")}
          value={ov.patients_total ?? 0}
          sub={t("admin.metricsPushSub", { count: ov.push_subscriptions ?? 0 })}
        />
        <StatCard
          label={t("admin.metricsSessions")}
          value={ov.sessions_total ?? 0}
          sub={t("admin.metricsLast30", { count: ov.sessions_30d ?? 0 })}
        />
        <StatCard
          label={t("admin.metricsPayments")}
          value={ov.payments_total ?? 0}
          sub={t("admin.metricsLast30", { count: ov.payments_30d ?? 0 })}
        />
      </div>

      <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
        <DailyBars daily={daily} accessor={(r) => r.active_users} label={t("admin.metricsActiveDaily")} />
        <DailyBars daily={daily} accessor={(r) => r.signups} label={t("admin.metricsSignupsDaily")} color="var(--green)" />
        <DailyBars daily={daily} accessor={(r) => r.sessions_created} label={t("admin.metricsSessionsDaily")} color="var(--charcoal-md)" />
      </div>

      <div style={{ marginTop:14, textAlign:"right" }}>
        <button onClick={load}
          style={{ fontSize:11, fontWeight:600, color:"var(--charcoal-md)", background:"none", border:"none", cursor:"pointer", padding:"4px 8px", fontFamily:"var(--font)" }}>
          {t("admin.metricsRefresh")}
        </button>
      </div>
    </>
  );
}

export function AdminPanel({ onViewAs, onClose, currentAdminId }) {
  const { t } = useT();
  const [tab, setTab] = useState("accounts");

  const tabs = [
    { k: "accounts", l: t("admin.tabAccounts") },
    { k: "metrics",  l: t("admin.tabMetrics") },
    { k: "bugs",     l: t("admin.tabBugs") },
  ];

  return (
    <div style={{ position:"fixed", inset:0, background:"var(--white)", zIndex:"var(--z-expediente)", display:"flex", flexDirection:"column" }}>
      <div style={{ background:"var(--nav-bg)", padding:"calc(var(--sat, 0px) + 14px) 16px 16px", flexShrink:0 }}>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:12 }}>
          <div style={{ fontFamily:"var(--font-d)", fontSize:"var(--text-lg)", fontWeight:800, color:"var(--white)" }}>{t("admin.title")}</div>
          <button onClick={onClose} aria-label={t("close")}
            style={{ background:"none", border:"none", color:"rgba(255,255,255,0.6)", cursor:"pointer" }}>
            <IconX size={18} />
          </button>
        </div>
        <div style={{ display:"flex", background:"rgba(255,255,255,0.08)", borderRadius:"var(--radius-pill)", padding:3, gap:2 }}>
          {tabs.map(tb => (
            <button key={tb.k} onClick={() => setTab(tb.k)}
              style={{
                flex:1, padding:"6px 10px", fontSize:12, fontWeight:700,
                borderRadius:"var(--radius-pill)", border:"none", cursor:"pointer",
                fontFamily:"var(--font)", minHeight:32,
                background: tab===tb.k ? "white" : "transparent",
                color: tab===tb.k ? "#1a1a2e" : "rgba(255,255,255,0.65)",
                transition:"all 0.4s",
              }}>
              {tb.l}
            </button>
          ))}
        </div>
      </div>

      <div style={{ flex:1, minHeight:0, overflowY:"auto", padding:16 }}>
        {tab === "accounts" && <AccountsTab onViewAs={onViewAs} currentAdminId={currentAdminId} />}
        {tab === "metrics"  && <MetricsTab />}
        {tab === "bugs"     && <BugsTab />}
      </div>
    </div>
  );
}
