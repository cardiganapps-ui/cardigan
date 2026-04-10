import { describe, it, expect } from "vitest";
import { getFileIcon, formatFileSize, isWordDoc, isImageDoc, isPdfDoc } from "../files";

describe("getFileIcon", () => {
  it("returns image icon for image types", () => {
    expect(getFileIcon({ file_type: "image/png" })).toBe("\u{1F5BC}");
    expect(getFileIcon({ file_type: "image/jpeg" })).toBe("\u{1F5BC}");
  });

  it("returns PDF icon", () => {
    expect(getFileIcon({ file_type: "application/pdf" })).toBe("\u{1F4C4}");
  });

  it("returns Word icon for word types", () => {
    expect(getFileIcon({ file_type: "application/msword" })).toBe("\u{1F4DD}");
    expect(getFileIcon({ file_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" })).toBe("\u{1F4DD}");
  });

  it("returns generic icon for unknown types", () => {
    expect(getFileIcon({ file_type: "text/plain" })).toBe("\u{1F4CE}");
    expect(getFileIcon({})).toBe("\u{1F4CE}");
  });
});

describe("formatFileSize", () => {
  it("formats bytes", () => {
    expect(formatFileSize(500)).toBe("500 B");
  });

  it("formats kilobytes", () => {
    expect(formatFileSize(2048)).toBe("2 KB");
  });

  it("formats megabytes", () => {
    expect(formatFileSize(5 * 1024 * 1024)).toBe("5.0 MB");
  });

  it("returns empty for falsy input", () => {
    expect(formatFileSize(0)).toBe("");
    expect(formatFileSize(null)).toBe("");
  });
});

describe("isWordDoc", () => {
  it("detects Word MIME types", () => {
    expect(isWordDoc({ file_type: "application/msword" })).toBe(true);
    expect(isWordDoc({ file_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" })).toBe(true);
  });

  it("detects Word file extensions", () => {
    expect(isWordDoc({ file_type: "application/octet-stream", name: "report.doc" })).toBe(true);
    expect(isWordDoc({ file_type: "application/octet-stream", name: "report.docx" })).toBe(true);
  });

  it("returns false for non-Word files", () => {
    expect(isWordDoc({ file_type: "image/png", name: "photo.png" })).toBe(false);
  });
});

describe("isImageDoc", () => {
  it("detects image types", () => {
    expect(isImageDoc({ file_type: "image/png" })).toBe(true);
    expect(isImageDoc({ file_type: "image/jpeg" })).toBe(true);
  });

  it("rejects non-images", () => {
    expect(isImageDoc({ file_type: "application/pdf" })).toBe(false);
  });
});

describe("isPdfDoc", () => {
  it("detects PDF type", () => {
    expect(isPdfDoc({ file_type: "application/pdf" })).toBe(true);
  });

  it("rejects non-PDFs", () => {
    expect(isPdfDoc({ file_type: "image/png" })).toBe(false);
  });
});
