import { useState, useMemo } from "react";
import { IconUpload } from "../../components/Icons";
import { NoteCard } from "../../components/NoteEditor";
import { DocumentList } from "../../components/DocumentList";
import { isWordDoc } from "../../utils/files";
import { useT } from "../../i18n/index";

export function ArchivoTab({
  patient, pNotes, pSessions, pDocuments,
  onNewNote, onEditNote,
  uploading, triggerUpload, onOpenDoc,
  renameDocument, tagDocumentSession, deleteDocument,
}) {
  const { t } = useT();
  const [docSort, setDocSort] = useState("newest");
  const [docFilter, setDocFilter] = useState("all");

  const sortedFilteredDocs = useMemo(() => {
    let docs = [...pDocuments];
    if (docFilter === "image") docs = docs.filter(d => d.file_type?.startsWith("image/"));
    else if (docFilter === "pdf") docs = docs.filter(d => d.file_type === "application/pdf");
    else if (docFilter === "doc") docs = docs.filter(d => isWordDoc(d));
    if (docSort === "oldest") docs.sort((a, b) => (a.created_at || "").localeCompare(b.created_at || ""));
    else if (docSort === "name") docs.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    return docs;
  }, [pDocuments, docSort, docFilter]);

  return (
    <div style={{ padding:16 }}>
      {/* ── Notas section ── */}
      <div style={{ display:"flex", alignItems:"baseline", justifyContent:"space-between", marginBottom:10 }}>
        <div style={{ fontSize:11, fontWeight:700, textTransform:"uppercase", letterSpacing:"0.07em", color:"var(--charcoal-xl)" }}>
          {t("expediente.notasSection")} · {pNotes.length}
        </div>
      </div>
      <button className="btn btn-primary" style={{ marginBottom:12 }} onClick={() => onNewNote(null)}>
        {t("notes.newNote")}
      </button>
      {pNotes.length === 0
        ? <div className="card" style={{ padding:"24px 16px", textAlign:"center", color:"var(--charcoal-xl)", fontSize:13 }}>
            {t("notes.noNotes")}
          </div>
        : <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
            {pNotes.map(n => {
              const linkedSession = n.session_id ? pSessions.find(s => s.id === n.session_id) : null;
              return (
                <div key={n.id} className="card" style={{ overflow:"hidden" }}>
                  <NoteCard
                    note={n}
                    onClick={() => onEditNote(n)}
                    sessionLabel={linkedSession ? `${linkedSession.date} · ${linkedSession.time}` : null}
                  />
                </div>
              );
            })}
          </div>
      }

      {/* ── Documentos section ── */}
      <div style={{ display:"flex", alignItems:"baseline", justifyContent:"space-between", marginTop:24, marginBottom:10 }}>
        <div style={{ fontSize:11, fontWeight:700, textTransform:"uppercase", letterSpacing:"0.07em", color:"var(--charcoal-xl)" }}>
          {t("expediente.docsSection")} · {pDocuments.length}
        </div>
      </div>
      <button className="btn btn-primary" style={{ marginBottom:12, display:"flex", alignItems:"center", justifyContent:"center", gap:6, width:"100%" }}
        onClick={triggerUpload} disabled={uploading}>
        <IconUpload size={16} />
        {uploading ? t("docs.uploading") : t("docs.upload")}
      </button>

      {/* Sort & Filter bar */}
      {pDocuments.length > 0 && (
        <div style={{ display:"flex", gap:6, marginBottom:12, flexWrap:"wrap" }}>
          <select value={docSort} onChange={e => setDocSort(e.target.value)}
            style={{ flex:1, minWidth:0, fontSize:11, fontWeight:600, fontFamily:"var(--font)", padding:"6px 8px", borderRadius:"var(--radius)", border:"1px solid var(--border)", background:"var(--white)", color:"var(--charcoal-md)", cursor:"pointer" }}>
            <option value="newest">{t("docs.newest")}</option>
            <option value="oldest">{t("docs.oldest")}</option>
            <option value="name">{t("docs.nameAZ")}</option>
          </select>
          <div style={{ display:"flex", gap:4 }}>
            {[
              { k:"all", l:t("docs.allTypes") },
              { k:"image", l:t("docs.image") },
              { k:"pdf", l:t("docs.pdf") },
              { k:"doc", l:t("docs.word") },
            ].map(f => (
              <button key={f.k} onClick={() => setDocFilter(f.k)}
                style={{ padding:"5px 10px", fontSize:10, fontWeight:600, borderRadius:"var(--radius-pill)", border:"none", cursor:"pointer", fontFamily:"var(--font)",
                  background: docFilter === f.k ? "var(--teal)" : "var(--cream)", color: docFilter === f.k ? "white" : "var(--charcoal-md)" }}>
                {f.l}
              </button>
            ))}
          </div>
        </div>
      )}

      <DocumentList
        documents={sortedFilteredDocs}
        sessions={pSessions}
        onOpen={onOpenDoc}
        onRename={renameDocument}
        onTag={tagDocumentSession}
        onDelete={deleteDocument}
        emptyMessage={pDocuments.length === 0 ? t("docs.patientDocsEmpty") : t("docs.noResults")}
        variant="cards"
      />
    </div>
  );
}
