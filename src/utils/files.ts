/** Minimal document shape these helpers read. Matches the relevant
    columns on a `documents` row (and any object carrying them). */
export interface DocLike {
  file_type?: string | null;
  name?: string | null;
}

export function getFileIcon(doc: DocLike): string {
  const t = doc.file_type || "";
  if (t.startsWith("image/")) return "\u{1F5BC}";
  if (t === "application/pdf") return "\u{1F4C4}";
  if (isWordDoc(doc)) return "\u{1F4DD}";
  return "\u{1F4CE}";
}

export function formatFileSize(bytes: number | null | undefined): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function isWordDoc(doc: DocLike): boolean {
  const t = doc.file_type || "";
  return t.includes("word") || t.includes("document") || !!doc.name?.endsWith(".doc") || !!doc.name?.endsWith(".docx");
}

export function isImageDoc(doc: DocLike): boolean {
  return !!doc.file_type?.startsWith("image/");
}

export function isPdfDoc(doc: DocLike): boolean {
  return doc.file_type === "application/pdf";
}
