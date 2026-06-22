import { useRef, useState } from "react";
import { useT } from "../../../i18n/index";
import { ConfirmDialog } from "../../../components/ConfirmDialog";
import { IconUpload, IconDocument, IconTrash } from "../../../components/Icons";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- loosely-typed document rows
type Row = any;

/* ── DocumentsCard ────────────────────────────────────────────────
   Patient's "Mis archivos" surface. Shows up to 3 most-recent
   uploads with an upload button; "Ver todos" expands when there
   are more. Each row: filename + size + open/delete actions.

   Empty state + uploading state + the file picker live here so
   the parent (PatientHome) only has to wire callbacks. The
   <input type="file"> is hidden behind the button — all major
   browsers accept the synthetic click on a hidden input. */
export function DocumentsCard({ documents, uploading, onUpload, onOpen, onRemove }: {
  documents: Row[];
  uploading?: boolean;
  onUpload: (file: File) => void;
  onOpen: (doc: Row) => void;
  onRemove: (doc: Row) => void;
}) {
  const { t } = useT();
  const fileRef = useRef<HTMLInputElement>(null);
  const [confirmRemove, setConfirmRemove] = useState<Row | null>(null);
  const [showAll, setShowAll] = useState(false);

  const handlePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Reset the input so the SAME file can be picked twice in a row
    // (common iOS pattern when a user re-shoots a photo and tries
    // again after a failed upload).
    e.target.value = "";
    if (file) onUpload(file);
  };

  const visible = showAll ? documents : documents.slice(0, 3);

  return (
    <div className="card" style={{ padding: 16, background: "var(--white)" }}>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          marginBottom: 10,
        }}
      >
        <div
          style={{
            fontSize: 11,
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.07em",
            color: "var(--charcoal-xl)",
          }}
        >
          {t("patientDocs.label")}{documents.length > 0 ? ` · ${documents.length}` : ""}
        </div>
        {documents.length > 3 && (
          <button
            type="button"
            onClick={() => setShowAll((v) => !v)}
            className="btn-tap"
            style={{
              background: "transparent",
              border: "none",
              cursor: "pointer",
              fontSize: 12,
              fontWeight: 600,
              color: "var(--teal-dark)",
              fontFamily: "var(--font)",
              padding: 0,
            }}
          >
            {showAll ? t("patientHome.collapse") : t("patientHome.seeAll")}
          </button>
        )}
      </div>

      {documents.length === 0 ? (
        <div
          style={{
            fontSize: 13,
            color: "var(--charcoal-md)",
            lineHeight: 1.5,
            marginBottom: 12,
          }}
        >
          {t("patientDocs.emptyBody")}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 12 }}>
          {visible.map((doc: Row) => (
            <DocumentRow
              key={doc.id}
              document={doc}
              onOpen={() => onOpen(doc)}
              onRemove={() => setConfirmRemove(doc)}
            />
          ))}
        </div>
      )}

      <input
        ref={fileRef}
        type="file"
        onChange={handlePick}
        accept="image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/plain,text/csv"
        style={{ display: "none" }}
      />
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        disabled={uploading}
        className="btn btn-primary"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          width: "100%",
          opacity: uploading ? 0.7 : 1,
        }}
      >
        <IconUpload size={14} />
        {uploading ? t("patientDocs.uploading") : t("patientDocs.uploadCta")}
      </button>

      <ConfirmDialog
        open={!!confirmRemove}
        title={t("patientDocs.removeConfirmTitle")}
        body={t("patientDocs.removeConfirmBody", { name: confirmRemove?.name || "" })}
        confirmLabel={t("patientDocs.removeConfirmCta")}
        cancelLabel={t("cancel")}
        destructive
        onConfirm={() => {
          const target = confirmRemove;
          setConfirmRemove(null);
          if (target) onRemove(target);
        }}
        onCancel={() => setConfirmRemove(null)}
      />
    </div>
  );
}

function DocumentRow({ document: doc, onOpen, onRemove }: {
  document: Row;
  onOpen: () => void;
  onRemove: () => void;
}) {
  const { t } = useT();
  const sizeLabel = formatBytes(doc.file_size);
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "8px 10px",
        border: "1px solid var(--border-lt)",
        borderRadius: "var(--radius)",
        background: "var(--white)",
      }}
    >
      <button
        type="button"
        onClick={onOpen}
        className="btn-tap"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          flex: 1,
          minWidth: 0,
          background: "transparent",
          border: "none",
          padding: 0,
          textAlign: "left",
          cursor: "pointer",
          fontFamily: "var(--font)",
          WebkitTapHighlightColor: "transparent",
        }}
      >
        <span
          style={{
            width: 32,
            height: 32,
            borderRadius: "50%",
            background: "var(--teal-pale)",
            color: "var(--teal-dark)",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
          aria-hidden="true"
        >
          <IconDocument size={14} />
        </span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span
            style={{
              display: "block",
              fontSize: 13,
              fontWeight: 600,
              color: "var(--charcoal)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {doc.name}
          </span>
          <span style={{ fontSize: 11, color: "var(--charcoal-xl)" }}>
            {sizeLabel}
          </span>
        </span>
      </button>
      <button
        type="button"
        onClick={onRemove}
        aria-label={t("patientDocs.removeAria", { name: doc.name })}
        className="btn-tap"
        style={{
          width: 32,
          height: 32,
          background: "transparent",
          border: "none",
          cursor: "pointer",
          color: "var(--charcoal-xl)",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: "50%",
          WebkitTapHighlightColor: "transparent",
          flexShrink: 0,
        }}
      >
        <IconTrash size={14} />
      </button>
    </div>
  );
}

function formatBytes(bytes: number | null | undefined) {
  // Render "—" for missing data (null/undefined/non-numeric); show
  // "0 B" for actual empty files (rare but valid — empty .txt etc).
  if (bytes == null || !Number.isFinite(Number(bytes)) || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
