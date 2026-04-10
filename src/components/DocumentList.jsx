import { useState } from "react";
import { IconEdit, IconTag, IconTrash } from "./Icons";
import { getFileIcon, formatFileSize } from "../utils/files";
import { useT } from "../i18n/index";

export function DocumentList({
  documents, sessions, patients,
  onOpen, onRename, onTag, onDelete,
  emptyMessage, showPatientName,
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
      <div className="card" style={{ padding:"32px 16px", textAlign:"center", color:"var(--charcoal-xl)", fontSize:13 }}>
        {emptyMessage || t("docs.noDocuments")}
      </div>
    );
  }

  return (
    <div className="card" style={{ padding:0 }}>
      {documents.map((doc, i) => {
        const p = showPatientName ? (patients || []).find(pt => pt.id === doc.patient_id) : null;
        const linkedSession = doc.session_id ? (sessions || []).find(s => s.id === doc.session_id) : null;
        const isRenaming = renamingDoc === doc.id;
        const isConfirmingDelete = confirmDeleteDoc === doc.id;
        const isTagging = taggingDoc === doc.id;
        const docSessions = isTagging
          ? (sessions || []).filter(s => s.patient_id === doc.patient_id).sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""))
          : [];

        return (
          <div key={doc.id} style={{ borderBottom: i < documents.length - 1 ? "1px solid var(--border-lt)" : "none" }}>
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
                    <button onClick={handleRename} style={{ padding:"4px 8px", fontSize:11, fontWeight:600, borderRadius:"var(--radius)", border:"none", background:"var(--teal)", color:"white", cursor:"pointer" }}>{t("ok")}</button>
                  </div>
                ) : (
                  <>
                    <div style={{ fontSize:13, fontWeight:600, color:"var(--teal-dark)", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", cursor:"pointer" }}
                      onClick={() => onOpen(doc)}>
                      {doc.name}
                    </div>
                    <div style={{ fontSize:10, color:"var(--charcoal-xl)", marginTop:2 }}>
                      {p && <span style={{ fontWeight:600 }}>{p.name} · </span>}
                      {formatFileSize(doc.file_size)}
                      {doc.created_at && ` · ${new Date(doc.created_at).toLocaleDateString("es-MX", { day:"numeric", month:"short", year:"numeric" })}`}
                    </div>
                  </>
                )}
              </div>
              {!isRenaming && (
                <div style={{ display:"flex", gap:2, flexShrink:0 }}>
                  <button onClick={() => { setRenamingDoc(doc.id); setRenameValue(doc.name || ""); }}
                    style={{ padding:6, background:"none", border:"none", cursor:"pointer", color:"var(--charcoal-xl)" }} title={t("docs.rename")}>
                    <IconEdit size={14} />
                  </button>
                  <button onClick={() => setTaggingDoc(taggingDoc === doc.id ? null : doc.id)}
                    style={{ padding:6, background:"none", border:"none", cursor:"pointer", color: doc.session_id ? "var(--teal-dark)" : "var(--charcoal-xl)" }} title={t("docs.linkSession")}>
                    <IconTag size={14} />
                  </button>
                  {isConfirmingDelete ? (
                    <div style={{ display:"flex", gap:2 }}>
                      <button onClick={() => handleDelete(doc.id)}
                        style={{ padding:"4px 8px", fontSize:10, fontWeight:700, borderRadius:"var(--radius)", border:"none", background:"var(--red)", color:"white", cursor:"pointer" }}>{t("yes")}</button>
                      <button onClick={() => setConfirmDeleteDoc(null)}
                        style={{ padding:"4px 8px", fontSize:10, fontWeight:700, borderRadius:"var(--radius)", border:"1px solid var(--border)", background:"var(--white)", color:"var(--charcoal-md)", cursor:"pointer" }}>{t("no")}</button>
                    </div>
                  ) : (
                    <button onClick={() => setConfirmDeleteDoc(doc.id)}
                      style={{ padding:6, background:"none", border:"none", cursor:"pointer", color:"var(--charcoal-xl)" }} title={t("delete")}>
                      <IconTrash size={14} />
                    </button>
                  )}
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
    </div>
  );
}
