import { IconChevron } from "./Icons";
import { getFileIcon, formatFileSize, isImageDoc, isPdfDoc } from "../utils/files";
import { useT } from "../i18n/index";

export function DocumentViewer({ doc, url, patientName, linkedSession, onClose, onPatientClick }) {
  const { t } = useT();
  const isImage = isImageDoc(doc);
  const isPdf = isPdfDoc(doc);

  return (
    <>
      <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.6)", zIndex:"var(--z-doc-viewer-bg)", animation:"fadeIn 0.5s ease" }}
        onClick={onClose} />
      <div style={{
        position:"fixed", top:"calc(var(--sat, 44px))", left:0, right:0, bottom:0, zIndex:"var(--z-doc-viewer)",
        display:"flex", flexDirection:"column", background:"var(--white)",
        borderRadius:"var(--radius-lg) var(--radius-lg) 0 0", overflow:"hidden",
        boxShadow:"var(--shadow-lg)",
        animation:"expedientePullUp 0.7s cubic-bezier(0.34, 1.56, 0.64, 1)",
      }}>
        <div style={{ background:"var(--white)", padding:"12px 16px", flexShrink:0, borderBottom:"1px solid var(--border-lt)" }}>
          <div style={{ display:"flex", alignItems:"center", gap:10 }}>
            <button onClick={onClose} aria-label={t("back")}
              style={{ padding:6, background:"none", border:"none", cursor:"pointer", color:"var(--charcoal-lt)", flexShrink:0, transform:"rotate(180deg)" }}>
              <IconChevron size={20} />
            </button>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ fontFamily:"var(--font-d)", fontSize:15, fontWeight:800, color:"var(--charcoal)", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                {doc.name}
              </div>
              <div style={{ fontSize:11, color:"var(--charcoal-xl)", marginTop:1 }}>
                {patientName && <span onClick={onPatientClick ? (e) => { e.stopPropagation(); onPatientClick(); } : undefined}
                  style={onPatientClick ? { cursor:"pointer", color:"var(--teal-dark)", fontWeight:600 } : undefined}>{patientName}</span>}
                {patientName && " · "}{formatFileSize(doc.file_size)}
                {linkedSession && ` · ${t("sessions.session")} ${linkedSession.date}`}
              </div>
            </div>
            <a href={url} target="_blank" rel="noopener noreferrer"
              style={{ padding:"6px 12px", fontSize:11, fontWeight:600, borderRadius:"var(--radius-pill)", border:"1.5px solid var(--border)", background:"transparent", color:"var(--charcoal-md)", cursor:"pointer", fontFamily:"var(--font)", textDecoration:"none", flexShrink:0 }}>
              {t("open")}
            </a>
          </div>
        </div>
        <div style={{ flex:1, overflow:"auto", display:"flex", alignItems:"center", justifyContent:"center", background: isImage ? "#1a1a1a" : "var(--white)" }}>
          {isImage && <img src={url} alt={doc.name} style={{ maxWidth:"100%", maxHeight:"100%", objectFit:"contain" }} />}
          {isPdf && <iframe src={url} title={doc.name} sandbox="allow-same-origin allow-scripts" style={{ width:"100%", height:"100%", border:"none" }} />}
          {!isImage && !isPdf && (
            <div style={{ textAlign:"center", padding:32, color:"var(--charcoal-xl)" }}>
              <div style={{ fontSize:48, marginBottom:12 }}>{getFileIcon(doc)}</div>
              <div style={{ fontSize:14, fontWeight:600, color:"var(--charcoal)", marginBottom:4 }}>{doc.name}</div>
              <div style={{ fontSize:12, marginBottom:16 }}>{t("docs.previewUnavailable")}</div>
              <a href={url} target="_blank" rel="noopener noreferrer" className="btn btn-primary" style={{ display:"inline-flex", textDecoration:"none" }}>
                {t("docs.download")}
              </a>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
