import { useState, useMemo, useRef } from "react";
import { IconSearch, IconUpload } from "../components/Icons";
import { isWordDoc, isImageDoc, isPdfDoc } from "../utils/files";
import { DocumentList } from "../components/DocumentList";
import { DocumentViewer } from "../components/DocumentViewer";
import { useCardigan } from "../context/CardiganContext";
import { useT } from "../i18n/index";
import { useSheetDrag } from "../hooks/useSheetDrag";

export function Documents() {
  const { documents, patients, upcomingSessions, uploadDocument, renameDocument, tagDocumentSession, deleteDocument, getDocumentUrl, mutating, openExpediente } = useCardigan();
  const { t } = useT();
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState("newest"); // newest | name
  const [filterPatient, setFilterPatient] = useState("all");
  const [filterType, setFilterType] = useState("all"); // all | image | pdf | doc
  const [uploading, setUploading] = useState(false);
  const [pendingFiles, setPendingFiles] = useState(null);
  const [viewingDoc, setViewingDoc] = useState(null);
  const fileInputRef = useRef(null);
  const closePending = () => setPendingFiles(null);
  const { scrollRef: pendingScrollRef, panelHandlers: pendingPanelHandlers, panelStyle: pendingPanelStyle } = useSheetDrag(closePending, { isOpen: !!pendingFiles });

  const MAX_FILE_SIZE = 10 * 1024 * 1024;

  // Patients with documents or active (for upload target)
  const activePatients = useMemo(() =>
    (patients || []).filter(p => p.status === "active").sort((a, b) => a.name.localeCompare(b.name)),
    [patients]
  );
  const patientsWithDocs = useMemo(() => {
    const ids = new Set((documents || []).map(d => d.patient_id).filter(Boolean));
    return (patients || []).filter(p => ids.has(p.id)).sort((a, b) => a.name.localeCompare(b.name));
  }, [documents, patients]);

  // Filter & sort
  const filteredDocs = useMemo(() => {
    let docs = [...(documents || [])];

    // Search
    if (search.trim()) {
      const q = search.toLowerCase();
      docs = docs.filter(d => {
        const p = patients.find(pt => pt.id === d.patient_id);
        return d.name?.toLowerCase().includes(q) || p?.name?.toLowerCase().includes(q);
      });
    }

    // Patient filter
    if (filterPatient === "general") {
      docs = docs.filter(d => !d.patient_id);
    } else if (filterPatient !== "all") {
      docs = docs.filter(d => d.patient_id === filterPatient);
    }

    // Type filter
    if (filterType === "image") docs = docs.filter(d => isImageDoc(d));
    else if (filterType === "pdf") docs = docs.filter(d => isPdfDoc(d));
    else if (filterType === "doc") docs = docs.filter(d => isWordDoc(d));

    // Sort
    if (sortBy === "name") docs.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    else docs.sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));

    return docs;
  }, [documents, search, filterPatient, filterType, sortBy, patients]);

  const handleFileSelect = (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    const oversized = files.filter(f => f.size > MAX_FILE_SIZE);
    if (oversized.length > 0) {
      alert(t("docs.sizeLimit", { names: oversized.map(f => f.name).join(", "), count: oversized.length }));
    }
    const valid = files.filter(f => f.size <= MAX_FILE_SIZE);
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (valid.length === 0) return;
    setPendingFiles(valid);
  };

  const confirmUpload = async (patientId) => {
    if (!pendingFiles) return;
    setUploading(true);
    setPendingFiles(null);
    try {
      for (const file of pendingFiles) {
        await uploadDocument({ patientId, file, sessionId: null, name: file.name });
      }
    } finally {
      setUploading(false);
    }
  };

  const openDocViewer = async (doc) => {
    let url;
    try { url = await getDocumentUrl(doc.file_path); } catch { return; }
    if (!url) return;
    if (isWordDoc(doc)) {
      window.open(url, "_blank");
      return;
    }
    setViewingDoc({ doc, url });
  };

  return (
    <>
    {viewingDoc && (
      <DocumentViewer
        doc={viewingDoc.doc} url={viewingDoc.url}
        patientName={(patients || []).find(pt => pt.id === viewingDoc.doc.patient_id)?.name}
        linkedSession={viewingDoc.doc.session_id ? (upcomingSessions || []).find(s => s.id === viewingDoc.doc.session_id) : null}
        onClose={() => setViewingDoc(null)}
        onPatientClick={(() => { const p = (patients || []).find(pt => pt.id === viewingDoc.doc.patient_id); return p ? () => { setViewingDoc(null); openExpediente(p); } : undefined; })()}
      />
    )}
    <div className="page" style={{ paddingTop:16, paddingLeft:16, paddingRight:16 }}>
      <div style={{ marginBottom:12 }}>
        <div className="section-title">{t("docs.title")}</div>
      </div>

      {/* Search bar */}
      <div className="search-bar" style={{ marginBottom:12 }}>
        <IconSearch size={16} style={{ color:"var(--charcoal-xl)" }} />
        <input placeholder={t("docs.searchPlaceholder")} value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      {/* Upload button */}
      <input ref={fileInputRef} type="file" multiple accept="image/*,.pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        style={{ display:"none" }} onChange={handleFileSelect} />
      <button className="btn btn-primary" style={{ width:"100%", fontSize:13, display:"flex", alignItems:"center", justifyContent:"center", gap:6, marginBottom:12 }}
        onClick={() => fileInputRef.current?.click()}
        disabled={uploading}>
        <IconUpload size={14} />
        {uploading ? "..." : t("docs.uploadBtn")}
      </button>

      {/* Patient picker after file selection */}
      {pendingFiles && (
        <div className="sheet-overlay" onClick={() => setPendingFiles(null)}>
          <div ref={pendingScrollRef} className="sheet-panel" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()} {...pendingPanelHandlers} style={{ maxHeight:"60vh", ...pendingPanelStyle }}>
            <div className="sheet-handle" />
            <div style={{ padding:"16px 20px 8px" }}>
              <div style={{ fontFamily:"var(--font-d)", fontSize:15, fontWeight:700, color:"var(--charcoal)", marginBottom:4 }}>
                {t("docs.linkToPatient")}
              </div>
              <div style={{ fontSize:12, color:"var(--charcoal-xl)", marginBottom:12 }}>
                {pendingFiles.length === 1 ? pendingFiles[0].name : t("docs.count", { count: pendingFiles.length })}
              </div>
            </div>
            <div style={{ overflowY:"auto", padding:"0 20px 22px" }}>
              <div className="card" style={{ padding:0 }}>
                <div className="row-item" role="button" tabIndex={0} style={{ cursor:"pointer" }}
                  onClick={() => confirmUpload(null)}>
                  <span style={{ fontSize:13, fontWeight:600, color:"var(--charcoal)" }}>{t("docs.general")}</span>
                </div>
                {activePatients.map(p => (
                  <div className="row-item" key={p.id} role="button" tabIndex={0} style={{ cursor:"pointer" }}
                    onClick={() => confirmUpload(p.id)}>
                    <span style={{ fontSize:13, fontWeight:600, color:"var(--charcoal)" }}>{p.name}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Filters & sort */}
      <div style={{ display:"flex", gap:6, marginBottom:12, flexWrap:"wrap", alignItems:"center" }}>
        {/* Sort */}
        <select value={sortBy} onChange={e => setSortBy(e.target.value)}
          style={{ fontSize:11, fontWeight:600, fontFamily:"var(--font)", padding:"6px 8px", borderRadius:"var(--radius)", border:"1px solid var(--border)", background:"var(--white)", color:"var(--charcoal-md)", cursor:"pointer" }}>
          <option value="newest">{t("docs.newest")}</option>
          <option value="name">{t("docs.nameAZ")}</option>
        </select>
        {/* Patient filter */}
        <select value={filterPatient} onChange={e => setFilterPatient(e.target.value)}
          style={{ fontSize:11, fontWeight:600, fontFamily:"var(--font)", padding:"6px 8px", borderRadius:"var(--radius)", border:"1px solid var(--border)", background:"var(--white)", color:"var(--charcoal-md)", cursor:"pointer", flex:1, minWidth:0 }}>
          <option value="all">{t("docs.allPatients")}</option>
          <option value="general">{t("docs.generalFilter")}</option>
          {patientsWithDocs.map(p => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </div>
      {/* Type filter pills */}
      <div style={{ display:"flex", gap:4, marginBottom:14 }}>
        {[
          { k:"all", l:t("docs.allTypes") },
          { k:"image", l:t("docs.image") },
          { k:"pdf", l:t("docs.pdf") },
          { k:"doc", l:t("docs.word") },
        ].map(f => (
          <button key={f.k} onClick={() => setFilterType(f.k)}
            style={{ padding:"5px 12px", fontSize:11, fontWeight:600, borderRadius:"var(--radius-pill)", border:"none", cursor:"pointer", fontFamily:"var(--font)",
              background: filterType === f.k ? "var(--teal)" : "var(--white)", color: filterType === f.k ? "white" : "var(--charcoal-md)",
              boxShadow: filterType === f.k ? "none" : "var(--shadow-sm)" }}>
            {f.l}
          </button>
        ))}
      </div>

      {/* Results count */}
      <div style={{ fontSize:11, color:"var(--charcoal-xl)", marginBottom:8 }}>
        {t("docs.count", { count: filteredDocs.length })}
        {filterPatient !== "all" && (() => { const p = patients.find(pt => pt.id === filterPatient); return p ? ` · ${p.name}` : ""; })()}
      </div>

      <DocumentList
        documents={filteredDocs}
        sessions={upcomingSessions}
        patients={patients}
        showPatientName
        onPatientClick={openExpediente}
        onOpen={openDocViewer}
        onRename={renameDocument}
        onTag={tagDocumentSession}
        onDelete={deleteDocument}
        emptyMessage={(documents || []).length === 0 ? t("docs.noDocuments") : t("docs.noResults")}
      />

    </div>
    </>
  );
}
