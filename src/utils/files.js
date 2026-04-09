export function getFileIcon(doc) {
  const t = doc.file_type || "";
  if (t.startsWith("image/")) return "\u{1F5BC}";
  if (t === "application/pdf") return "\u{1F4C4}";
  if (isWordDoc(doc)) return "\u{1F4DD}";
  return "\u{1F4CE}";
}

export function formatFileSize(bytes) {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function isWordDoc(doc) {
  const t = doc.file_type || "";
  return t.includes("word") || t.includes("document") || doc.name?.endsWith(".doc") || doc.name?.endsWith(".docx");
}

export function isImageDoc(doc) {
  return doc.file_type?.startsWith("image/");
}

export function isPdfDoc(doc) {
  return doc.file_type === "application/pdf";
}
