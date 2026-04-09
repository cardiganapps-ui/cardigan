import { useState, useMemo, useRef } from "react";
import { clientColors } from "../data/seedData";
import { IconSearch, IconUpload, IconEdit, IconTag, IconTrash, IconChevron, IconDocument } from "../components/Icons";
import { shortDateToISO } from "../utils/dates";
import { isTutorSession, statusLabel } from "../utils/sessions";

export function Documents({
  documents, patients, upcomingSessions,
  uploadDocument, renameDocument, tagDocumentSession, deleteDocument, getDocumentUrl,
  mutating,
}) {
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState("newest"); // newest | oldest | name
  const [filterPatient, setFilterPatient] = useState("all");
  const [filterType, setFilterType] = useState("all"); // all | image | pdf | doc
  const [renamingDoc, setRenamingDoc] = useState(null);
  const [renameValue, setRenameValue] = useState("");
  const [taggingDoc, setTaggingDoc] = useState(null);
  const [confirmDeleteDoc, setConfirmDeleteDoc] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadPatientId, setUploadPatientId] = useState("");
  const [viewingDoc, setViewingDoc] = useState(null);
  const fileInputRef = useRef(null);

  const MAX_FILE_SIZE = 10 * 1024 * 1024;

  // Patients with documents or active (for upload target)
  const activePatients = useMemo(() =>
    (patients || []).filter(p => p.status === "active").sort((a, b) => a.name.localeCompare(b.name)),
    [patients]
  );
  const patientsWithDocs = useMemo(() => {
    const ids = new Set((documents || []).map(d => d.patient_id));
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
    if (filterPatient !== "all") {
      docs = docs.filter(d => d.patient_id === filterPatient);
    }

    // Type filter
    if (filterType === "image") docs = docs.filter(d => d.file_type?.startsWith("image/"));
    else if (filterType === "pdf") docs = docs.filter(d => d.file_type === "application/pdf");
    else if (filterType === "doc") docs = docs.filter(d => d.file_type?.includes("word") || d.file_type?.includes("document") || d.name?.endsWith(".doc") || d.name?.endsWith(".docx"));

    // Sort
    if (sortBy === "oldest") docs.sort((a, b) => (a.created_at || "").localeCompare(b.created_at || ""));
    else if (sortBy === "name") docs.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    else docs.sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));

    return docs;
  }, [documents, search, filterPatient, filterType, sortBy, patients]);

  const handleFileUpload = async (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0 || !uploadPatientId) return;
    const oversized = files.filter(f => f.size > MAX_FILE_SIZE);
    if (oversized.length > 0) {
      alert(`${oversized.map(f => f.name).join(", ")} excede${oversized.length > 1 ? "n" : ""} el límite de 10 MB`);
    }
    const valid = files.filter(f => f.size <= MAX_FILE_SIZE);
    if (valid.length === 0) { if (fileInputRef.current) fileInputRef.current.value = ""; return; }
    setUploading(true);
    for (const file of valid) {
      await uploadDocument({ patientId: uploadPatientId, file, sessionId: null, name: file.name });
    }
    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleRename = async () => {
    if (renamingDoc && renameValue.trim()) {
      await renameDocument(renamingDoc, renameValue.trim());
    }
    setRenamingDoc(null);
    setRenameValue("");
  };

  const handleTag = async (docId, sessionId) => {
    await tagDocumentSession(docId, sessionId);
    setTaggingDoc(null);
  };

  const handleDeleteDoc = async (id) => {
    await deleteDocument(id);
    setConfirmDeleteDoc(null);
  };

  const openDocViewer = async (doc) => {
    const url = await getDocumentUrl(doc.file_path);
    if (!url) return;
    const t = doc.file_type || "";
    if (t.includes("word") || t.includes("document") || doc.name?.endsWith(".doc") || doc.name?.endsWith(".docx")) {
      window.open(url, "_blank");
      return;
    }
    setViewingDoc({ doc, url });
  };

  const getFileIcon = (doc) => {
    const t = doc.file_type || "";
    if (t.startsWith("image/")) return "\u{1F5BC}";
    if (t === "application/pdf") return "\u{1F4C4}";
    if (t.includes("word") || t.includes("document")) return "\u{1F4DD}";
    return "\u{1F4CE}";
  };

  const formatFileSize = (bytes) => {
    if (!bytes) return "";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const getPatientSessions = (patientId) =>
    (upcomingSessions || []).filter(s => s.patient_id === patientId)
      .sort((a, b) => {
        const da = shortDateToISO(a.date), db = shortDateToISO(b.date);
        return db.localeCompare(da);
      });

  // Document viewer overlay
  if (viewingDoc) {
    const { doc, url } = viewingDoc;
    const isImage = doc.file_type?.startsWith("image/");
    const isPdf = doc.file_type === "application/pdf";
    const p = patients.find(pt => pt.id === doc.patient_id);
    const linkedSession = doc.session_id ? (upcomingSessions || []).find(s => s.id === doc.session_id) : null;
    return (
      <div style={{ display:"flex", flexDirection:"column", height:"100%", background:"var(--cream)" }}>
        {/* Header */}
        <div style={{ background:"var(--nav-bg)", padding:"12px 16px", flexShrink:0 }}>
          <div style={{ display:"flex", alignItems:"center", gap:10 }}>
            <button onClick={() => setViewingDoc(null)}
              style={{ padding:6, background:"none", border:"none", cursor:"pointer", color:"rgba(255,255,255,0.7)", flexShrink:0, transform:"rotate(180deg)" }}>
              <IconChevron size={20} />
            </button>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ fontFamily:"var(--font-d)", fontSize:15, fontWeight:800, color:"white", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                {doc.name}
              </div>
              <div style={{ fontSize:11, color:"rgba(255,255,255,0.5)", marginTop:1 }}>
                {p?.name} · {formatFileSize(doc.file_size)}
                {linkedSession && ` · Sesión ${linkedSession.date}`}
              </div>
            </div>
            <a href={url} target="_blank" rel="noopener noreferrer"
              style={{ padding:"6px 12px", fontSize:11, fontWeight:600, borderRadius:"var(--radius-pill)", border:"1.5px solid rgba(255,255,255,0.3)", background:"transparent", color:"rgba(255,255,255,0.8)", cursor:"pointer", fontFamily:"var(--font)", textDecoration:"none", flexShrink:0 }}>
              Abrir
            </a>
          </div>
        </div>
        {/* Content */}
        <div style={{ flex:1, overflow:"auto", display:"flex", alignItems:"center", justifyContent:"center", background: isImage ? "#1a1a1a" : "var(--cream)" }}>
          {isImage && <img src={url} alt={doc.name} style={{ maxWidth:"100%", maxHeight:"100%", objectFit:"contain" }} />}
          {isPdf && <iframe src={url} title={doc.name} style={{ width:"100%", height:"100%", border:"none" }} />}
          {!isImage && !isPdf && (
            <div style={{ textAlign:"center", padding:32, color:"var(--charcoal-xl)" }}>
              <div style={{ fontSize:48, marginBottom:12 }}>{getFileIcon(doc)}</div>
              <div style={{ fontSize:14, fontWeight:600, color:"var(--charcoal)", marginBottom:4 }}>{doc.name}</div>
              <div style={{ fontSize:12, marginBottom:16 }}>Vista previa no disponible</div>
              <a href={url} target="_blank" rel="noopener noreferrer" className="btn btn-primary" style={{ display:"inline-flex", textDecoration:"none" }}>
                Descargar archivo
              </a>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding:16 }}>
      <div className="section-title" style={{ marginBottom:12 }}>Documentos</div>

      {/* Search bar */}
      <div className="search-bar" style={{ marginBottom:12 }}>
        <IconSearch size={16} style={{ color:"var(--charcoal-xl)" }} />
        <input placeholder="Buscar por nombre o paciente..." value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      {/* Upload area */}
      <div className="card" style={{ padding:"12px 14px", marginBottom:12 }}>
        <div style={{ fontSize:11, fontWeight:700, textTransform:"uppercase", letterSpacing:"0.07em", color:"var(--charcoal-xl)", marginBottom:8 }}>Subir documento</div>
        <div style={{ display:"flex", gap:8 }}>
          <select value={uploadPatientId} onChange={e => setUploadPatientId(e.target.value)}
            style={{ flex:1, fontSize:12, fontFamily:"var(--font)", padding:"8px 10px", borderRadius:"var(--radius)", border:"1.5px solid var(--border)", background:"var(--white)", color: uploadPatientId ? "var(--charcoal)" : "var(--charcoal-xl)" }}>
            <option value="">Seleccionar paciente...</option>
            {activePatients.map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <input ref={fileInputRef} type="file" multiple accept="image/*,.pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            style={{ display:"none" }} onChange={handleFileUpload} />
          <button className="btn btn-primary" style={{ padding:"8px 16px", fontSize:12, display:"flex", alignItems:"center", gap:5, width:"auto" }}
            onClick={() => { if (!uploadPatientId) { alert("Selecciona un paciente primero"); return; } fileInputRef.current?.click(); }}
            disabled={uploading}>
            <IconUpload size={14} />
            {uploading ? "..." : "Subir"}
          </button>
        </div>
      </div>

      {/* Filters & sort */}
      <div style={{ display:"flex", gap:6, marginBottom:12, flexWrap:"wrap", alignItems:"center" }}>
        {/* Sort */}
        <select value={sortBy} onChange={e => setSortBy(e.target.value)}
          style={{ fontSize:11, fontWeight:600, fontFamily:"var(--font)", padding:"6px 8px", borderRadius:"var(--radius)", border:"1px solid var(--border)", background:"var(--white)", color:"var(--charcoal-md)", cursor:"pointer" }}>
          <option value="newest">Más reciente</option>
          <option value="oldest">Más antiguo</option>
          <option value="name">Nombre A-Z</option>
        </select>
        {/* Patient filter */}
        <select value={filterPatient} onChange={e => setFilterPatient(e.target.value)}
          style={{ fontSize:11, fontWeight:600, fontFamily:"var(--font)", padding:"6px 8px", borderRadius:"var(--radius)", border:"1px solid var(--border)", background:"var(--white)", color:"var(--charcoal-md)", cursor:"pointer", flex:1, minWidth:0 }}>
          <option value="all">Todos los pacientes</option>
          {patientsWithDocs.map(p => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </div>
      {/* Type filter pills */}
      <div style={{ display:"flex", gap:4, marginBottom:14 }}>
        {[
          { k:"all", l:"Todos" },
          { k:"image", l:"Imagen" },
          { k:"pdf", l:"PDF" },
          { k:"doc", l:"Word" },
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
        {filteredDocs.length} documento{filteredDocs.length !== 1 ? "s" : ""}
        {filterPatient !== "all" && (() => { const p = patients.find(pt => pt.id === filterPatient); return p ? ` · ${p.name}` : ""; })()}
      </div>

      {/* Document list */}
      {filteredDocs.length === 0
        ? <div className="card" style={{ padding:"32px 16px", textAlign:"center", color:"var(--charcoal-xl)", fontSize:13 }}>
            {(documents || []).length === 0 ? "Aún no hay documentos subidos" : "Sin resultados para este filtro"}
          </div>
        : <div className="card" style={{ padding:0 }}>
            {filteredDocs.map((doc, i) => {
              const p = patients.find(pt => pt.id === doc.patient_id);
              const linkedSession = doc.session_id ? (upcomingSessions || []).find(s => s.id === doc.session_id) : null;
              const isRenaming = renamingDoc === doc.id;
              const isConfirmingDelete = confirmDeleteDoc === doc.id;
              const isTagging = taggingDoc === doc.id;
              const patientSessions = isTagging ? getPatientSessions(doc.patient_id) : [];
              return (
                <div key={doc.id} style={{ borderBottom: i < filteredDocs.length - 1 ? "1px solid var(--border-lt)" : "none" }}>
                  {/* Session tag */}
                  {linkedSession && (
                    <div style={{ padding:"6px 14px 0", fontSize:10, color:"var(--teal-dark)", fontWeight:600 }}>
                      Sesión {linkedSession.date} · {linkedSession.time}
                    </div>
                  )}
                  <div style={{ display:"flex", alignItems:"center", padding:"10px 14px", gap:10 }}>
                    {/* File icon */}
                    <div style={{ fontSize:24, lineHeight:1, flexShrink:0 }}>{getFileIcon(doc)}</div>
                    {/* Name & info */}
                    <div style={{ flex:1, minWidth:0 }}>
                      {isRenaming ? (
                        <div style={{ display:"flex", gap:4 }}>
                          <input className="input" value={renameValue} onChange={e => setRenameValue(e.target.value)}
                            onKeyDown={e => { if (e.key === "Enter") handleRename(); if (e.key === "Escape") { setRenamingDoc(null); setRenameValue(""); } }}
                            autoFocus style={{ fontSize:12, padding:"4px 6px", flex:1 }} />
                          <button onClick={handleRename} style={{ padding:"4px 8px", fontSize:11, fontWeight:600, borderRadius:"var(--radius)", border:"none", background:"var(--teal)", color:"white", cursor:"pointer" }}>OK</button>
                        </div>
                      ) : (
                        <>
                          <div style={{ fontSize:13, fontWeight:600, color:"var(--teal-dark)", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", cursor:"pointer" }}
                            onClick={() => openDocViewer(doc)}>
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
                    {/* Actions */}
                    {!isRenaming && (
                      <div style={{ display:"flex", gap:2, flexShrink:0 }}>
                        <button onClick={() => { setRenamingDoc(doc.id); setRenameValue(doc.name || ""); }}
                          style={{ padding:6, background:"none", border:"none", cursor:"pointer", color:"var(--charcoal-xl)" }} title="Renombrar">
                          <IconEdit size={14} />
                        </button>
                        <button onClick={() => setTaggingDoc(taggingDoc === doc.id ? null : doc.id)}
                          style={{ padding:6, background:"none", border:"none", cursor:"pointer", color: doc.session_id ? "var(--teal-dark)" : "var(--charcoal-xl)" }} title="Vincular a sesión">
                          <IconTag size={14} />
                        </button>
                        {isConfirmingDelete ? (
                          <div style={{ display:"flex", gap:2 }}>
                            <button onClick={() => handleDeleteDoc(doc.id)}
                              style={{ padding:"4px 8px", fontSize:10, fontWeight:700, borderRadius:"var(--radius)", border:"none", background:"var(--red)", color:"white", cursor:"pointer" }}>Sí</button>
                            <button onClick={() => setConfirmDeleteDoc(null)}
                              style={{ padding:"4px 8px", fontSize:10, fontWeight:700, borderRadius:"var(--radius)", border:"1px solid var(--border)", background:"var(--white)", color:"var(--charcoal-md)", cursor:"pointer" }}>No</button>
                          </div>
                        ) : (
                          <button onClick={() => setConfirmDeleteDoc(doc.id)}
                            style={{ padding:6, background:"none", border:"none", cursor:"pointer", color:"var(--charcoal-xl)" }} title="Eliminar">
                            <IconTrash size={14} />
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                  {/* Tag to session dropdown */}
                  {isTagging && (
                    <div style={{ padding:"0 14px 10px" }}>
                      <div style={{ fontSize:10, fontWeight:600, color:"var(--charcoal-xl)", marginBottom:4 }}>Vincular a sesión:</div>
                      <select value={doc.session_id || ""} onChange={e => handleTag(doc.id, e.target.value || null)}
                        style={{ width:"100%", fontSize:11, fontFamily:"var(--font)", padding:"6px 8px", borderRadius:"var(--radius)", border:"1px solid var(--border)", background:"var(--white)", color:"var(--charcoal-md)" }}>
                        <option value="">Sin vincular</option>
                        {patientSessions.map(s => (
                          <option key={s.id} value={s.id}>{s.date} · {s.time} — {statusLabel(s.status)}</option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
      }
    </div>
  );
}
