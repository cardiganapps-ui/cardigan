import { useState } from "react";
import { IconEdit, IconTag, IconTrash } from "./Icons";
import { ConfirmDialog } from "./ConfirmDialog";
import { EmptyState } from "./EmptyState";
import { getFileIcon, formatFileSize } from "../utils/files";
import { useT } from "../i18n/index";

export function DocumentList({
  documents, sessions, patients,
  onOpen, onRename, onTag, onDelete,
  emptyMessage, showPatientName, onPatientClick,
  variant = "list", // "list" (single card with dividers) | "cards" (individual cards with gaps)
}) {
  const { t } = useT();
  const [renamingDoc, setRenamingDoc] = useState(null);
  const [renameValue, setRenameValue] = useState("");
  const [taggingDoc, setTaggingDoc] = useState(null);
  const [confirmDeleteDoc, setConfirmDeleteDoc] = useState(null);

  const handleRename = async () => {
    if (renamingDoc && renameValue.trim()) {
      await onRename(renamingDoc, renameValue.trim());
    }
    setRenamingDoc(null);
    setRenameValue("");
  };

  const handleTag = async (docId, sessionId) => {
    await onTag(docId, sessionId);
    setTaggingDoc(null);
  };

  const handleDelete = async (id) => {
    await onDelete(id);
    setConfirmDeleteDoc(null);
  };

  if (documents.length === 0) {
    return (
      <EmptyState
        kind="documents"
        title={emptyMessage || t("docs.noDocuments")}
        body={t("docs.emptyHint")}
        compact
      />
    );
  }

  const isCards = variant === "cards";
  const containerStyle = isCards
    ? { display: "flex", flexDirection: "column", gap: 8 }
    : { padding: 0 };
  const containerClass = isCards ? undefined : "card";

  return (
    <div className={containerClass} style={containerStyle}>
      {documents.map((doc, i) => {
        const p = showPatientName ? (patients || []).find(pt => pt.id === doc.patient_id) : null;
        const linkedSession = doc.session_id ? (sessions || []).find(s => s.id === doc.session_id) : null;
        const isRenaming = renamingDoc === doc.id;
        const isTagging = taggingDoc === doc.id;
        const docSessions = isTagging
          ? (sessions || []).filter(s => s.patient_id === doc.patient_id).sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""))
          : [];

        const itemClass = `${isCards ? "card" : ""} list-entry-stagger`.trim();
        const itemStyle = {
          "--stagger-i": Math.min(i, 12),
          ...(isCards
            ? { overflow: "hidden" }
            : { borderBottom: i < documents.length - 1 ? "1px solid var(--border-lt)" : "none" }),
        };

        return (
          <div key={doc.id} className={itemClass} style={itemStyle}>
            {linkedSession && (
              <div style={{ padding:"6px 14px 0", fontSize:10, color:"var(--teal-dark)", fontWeight:600 }}>
                {t("sessions.session")} {linkedSession.date} · {linkedSession.time}
              </div>
            )}
            <div style={{ display:"flex", alignItems:"center", padding:"10px 14px", gap:10 }}>
              <div style={{ fontSize:24, lineHeight:1, flexShrink:0 }}>{getFileIcon(doc)}</div>
              <div style={{ flex:1, minWidth:0 }}>
                {isRenaming ? (
                  <div style={{ display:"flex", gap:4 }}>
                    <input className="input" value={renameValue} onChange={e => setRenameValue(e.target.value)}
                      onKeyDown={e => { if (e.key === "Enter") handleRename(); if (e.key === "Escape") { setRenamingDoc(null); setRenameValue(""); } }}
                      autoFocus style={{ fontSize:12, padding:"4px 6px", flex:1 }} />
                    <button onClick={handleRename} style={{ padding:"4px 8px", fontSize:"var(--text-xs)", fontWeight:600, borderRadius:"var(--radius)", border:"none", background:"var(--teal)", color:"var(--white)", cursor:"pointer" }}>{t("ok")}</button>
                  </div>
                ) : (
                  <>
                    <div style={{ fontSize:13, fontWeight:600, color:"var(--teal-dark)", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", cursor:"pointer" }}
                      onClick={() => onOpen(doc)}>
                      {doc.name}
                    </div>
                    <div style={{ fontSize:10, color:"var(--charcoal-xl)", marginTop:2 }}>
                      {p && <span style={{ fontWeight:600, cursor: onPatientClick ? "pointer" : undefined, color: onPatientClick ? "var(--teal-dark)" : undefined }}
                        onClick={onPatientClick ? (e) => { e.stopPropagation(); onPatientClick(p); } : undefined}>{p.name} · </span>}
                      {formatFileSize(doc.file_size)}
                      {doc.created_at && ` · ${new Date(doc.created_at).toLocaleDateString("es-MX", { day:"numeric", month:"short", year:"numeric" })}`}
                    </div>
                  </>
                )}
              </div>
              {!isRenaming && (
                <div style={{ display:"flex", gap:2, flexShrink:0 }}>
                  <button onClick={() => { setRenamingDoc(doc.id); setRenameValue(doc.name || ""); }}
                    style={{ padding:10, background:"none", border:"none", cursor:"pointer", color:"var(--charcoal-xl)", display:"flex", alignItems:"center", justifyContent:"center" }} title={t("docs.rename")} aria-label={t("docs.rename")}>
                    <IconEdit size={14} />
                  </button>
                  <button onClick={() => setTaggingDoc(taggingDoc === doc.id ? null : doc.id)}
                    style={{ padding:10, background:"none", border:"none", cursor:"pointer", color: doc.session_id ? "var(--teal-dark)" : "var(--charcoal-xl)", display:"flex", alignItems:"center", justifyContent:"center" }} title={t("docs.linkSession")} aria-label={t("docs.linkSession")}>
                    <IconTag size={14} />
                  </button>
                  <button onClick={() => setConfirmDeleteDoc(doc.id)}
                    style={{ padding:10, background:"none", border:"none", cursor:"pointer", color:"var(--charcoal-xl)", display:"flex", alignItems:"center", justifyContent:"center" }} title={t("delete")} aria-label={t("delete")}>
                    <IconTrash size={14} />
                  </button>
                </div>
              )}
            </div>
            {isTagging && (
              <div style={{ padding:"0 14px 10px" }}>
                <div style={{ fontSize:10, fontWeight:600, color:"var(--charcoal-xl)", marginBottom:4 }}>{t("docs.linkSessionLabel")}</div>
                <select value={doc.session_id || ""} onChange={e => handleTag(doc.id, e.target.value || null)}
                  style={{ width:"100%", fontSize:11, fontFamily:"var(--font)", padding:"6px 8px", borderRadius:"var(--radius)", border:"1px solid var(--border)", background:"var(--white)", color:"var(--charcoal-md)" }}>
                  <option value="">{t("docs.unlink")}</option>
                  {docSessions.map(s => (
                    <option key={s.id} value={s.id}>{s.date} · {s.time} — {t(`sessions.${s.status}`)}</option>
                  ))}
                </select>
              </div>
            )}
          </div>
        );
      })}
      <ConfirmDialog
        open={!!confirmDeleteDoc}
        title={t("docs.deleteConfirmTitle") || t("delete")}
        body={(() => {
          const d = documents.find(x => x.id === confirmDeleteDoc);
          return d ? (t("docs.deleteConfirmBody", { name: d.name }) || d.name) : "";
        })()}
        confirmLabel={t("delete")}
        destructive
        onConfirm={() => handleDelete(confirmDeleteDoc)}
        onCancel={() => setConfirmDeleteDoc(null)}
      />
    </div>
  );
}
