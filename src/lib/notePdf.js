/* ── Note PDF generator ─────────────────────────────────────────────
   Phase 6 of the Notes premium roadmap. Renders a single note to
   a PDF the therapist can save, email, or hand to a colleague.

   Why jsPDF (and not server-side puppeteer): notes are short,
   single-author, and have minimal CSS surface. A 200MB chromium
   cold start on Vercel costs us more (latency + infra) than the
   ~50ms of client work. Pattern proven by monthlySummaryPdf.js.

   Pure helper. The caller is responsible for resolving image
   attachments — we accept an optional async `imageResolver`
   callback that takes an attachment row and returns a data URL
   (or null to skip the image). Keeps this module ignorant of
   R2, presigned URLs, and the noteCrypto bag.

   Markdown coverage (v1 — matches what the in-app editor actually
   renders):
     • Block: h1 / h2 / h3, paragraph, ul, ol, task ([ ] / [x])
     • Inline: **strong** (rendered bold), *em* (italic),
       `code` (mono), ~~strike~~ (rendered with overstrike line)
     • Images: `![](attachment:<id>)` placeholders are replaced
       inline with the resolved attachment (cap MAX_INLINE_IMAGES)
     • Skipped in v1: tables, blockquotes, raw HTML, links — none
       are produced by our editor, so adding renderers would be
       dead-code surface.

   Output: jsPDF instance. Caller chooses .save() / .output() /
   etc. The convenience downloader at the bottom does .save() with
   a slugged filename. */

import { jsPDF } from "jspdf";
import { tokenizeLine } from "../components/notes/markdownModel.js";

const MAX_INLINE_IMAGES = 10;

// Page geometry — US Letter in mm matches monthlySummaryPdf.js so
// the two look like a family when stapled together.
const PAGE = {
  format: "letter",
  unit: "mm",
  margin: 18,
};

// Colour palette mirrors the design tokens: charcoal text, lighter
// charcoal for meta, teal accents. jsPDF takes 0–255 RGB.
const COLORS = {
  charcoal:    [46, 46, 46],
  charcoalMd:  [110, 110, 110],
  charcoalXl:  [160, 160, 160],
  teal:        [62, 145, 145],
  hairline:    [225, 225, 225],
  codeBg:      [244, 240, 235],
  strikeRule:  [180, 180, 180],
};

function setColor(doc, [r, g, b]) {
  doc.setTextColor(r, g, b);
}

// Wrap one logical line of inline tokens into multiple physical
// lines, advancing the cursor and applying per-segment font style.
// Returns the y position after rendering. We do the wrap ourselves
// (rather than jsPDF.splitTextToSize) because we need to preserve
// inline style boundaries across wraps.
function renderInlineSegments(doc, segments, x, y, maxWidth, lineHeight) {
  // segments: [{ text, kind: "text" | "strong" | "em" | "strike" | "code" }]
  let cursorX = x;
  // jsPDF measures width using the currently-set font; we'll set
  // it per segment as we lay out.
  const setStyle = (kind) => {
    if (kind === "strong") doc.setFont("helvetica", "bold");
    else if (kind === "em") doc.setFont("helvetica", "italic");
    else if (kind === "code") doc.setFont("courier", "normal");
    else doc.setFont("helvetica", "normal");
  };

  // Walk word-by-word so we can break cleanly. Pre-tokenise each
  // segment into words but keep the segment style attached.
  const words = [];
  for (const seg of segments) {
    if (!seg.text) continue;
    const parts = seg.text.split(/(\s+)/); // keep whitespace
    for (const p of parts) {
      if (!p) continue;
      words.push({ text: p, kind: seg.kind });
    }
  }

  for (const w of words) {
    setStyle(w.kind);
    const wordWidth = doc.getTextWidth(w.text);
    const fitsOnCurrentLine = cursorX + wordWidth <= x + maxWidth;
    const isWhitespace = /^\s+$/.test(w.text);
    if (!fitsOnCurrentLine && !isWhitespace) {
      // Soft-break: wrap to the next line, discarding the trailing
      // whitespace that would otherwise lead the new line.
      y += lineHeight;
      cursorX = x;
    }
    if (isWhitespace && cursorX === x) continue; // leading WS suppressed

    // Render the word.
    if (w.kind === "code") {
      // Subtle background tint so inline code reads as code in
      // print. Pad the rect a touch beyond the text bounds.
      const h = lineHeight * 0.78;
      doc.setFillColor(...COLORS.codeBg);
      doc.rect(cursorX - 0.6, y - h + 1.2, wordWidth + 1.2, h, "F");
    }
    doc.text(w.text, cursorX, y);
    if (w.kind === "strike") {
      // jsPDF has no native strike — draw a hairline through the
      // word at roughly cap-x-height.
      doc.setDrawColor(...COLORS.strikeRule);
      doc.setLineWidth(0.18);
      doc.line(cursorX, y - 1.3, cursorX + wordWidth, y - 1.3);
    }
    cursorX += wordWidth;
  }
  return y;
}

function tokenInlineToSegments(tokenInline) {
  // The markdown model's inline kinds are: text | strong | em | strike | code.
  // We map directly — the renderer cares about font style.
  return tokenInline.map(tok => ({
    text: tok.text || "",
    kind: tok.kind,
  }));
}

// Detect every `![alt](attachment:<id>)` in a line. Multiple refs
// on one line are rendered as sequential image rows in v1 (mixed
// inline text + image would need a real layout pass we don't
// need yet, but at least we stop silently dropping the 2nd+
// reference).
function extractAttachmentRefs(line) {
  if (!line) return [];
  const out = [];
  const re = /!\[[^\]]*\]\(attachment:([0-9a-f-]+)\)/gi;
  let m;
  while ((m = re.exec(line)) !== null) {
    out.push({ id: m[1], full: m[0], index: m.index });
  }
  return out;
}

function addPageBreakIfNeeded(doc, y, neededHeight) {
  const pageHeight = doc.internal.pageSize.getHeight();
  const footerReserve = 16;
  if (y + neededHeight > pageHeight - footerReserve) {
    doc.addPage();
    return PAGE.margin;
  }
  return y;
}

function drawHeader(doc, { therapistName }) {
  const pageWidth = doc.internal.pageSize.getWidth();
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  setColor(doc, COLORS.charcoal);
  doc.text("Cardigan", PAGE.margin, PAGE.margin + 4);
  if (therapistName) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    setColor(doc, COLORS.charcoalMd);
    doc.text(therapistName, pageWidth - PAGE.margin, PAGE.margin + 4, { align: "right" });
  }
  // Divider — same hairline treatment as the monthly summary.
  doc.setDrawColor(...COLORS.hairline);
  doc.line(PAGE.margin, PAGE.margin + 8, pageWidth - PAGE.margin, PAGE.margin + 8);
  return PAGE.margin + 16;
}

function drawTitle(doc, title, y) {
  const pageWidth = doc.internal.pageSize.getWidth();
  const maxWidth = pageWidth - PAGE.margin * 2;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(22);
  setColor(doc, COLORS.charcoal);
  const wrapped = doc.splitTextToSize(title || "Sin título", maxWidth);
  for (const line of wrapped) {
    y = addPageBreakIfNeeded(doc, y, 10);
    doc.text(line, PAGE.margin, y);
    y += 10;
  }
  return y + 2;
}

function drawMetadata(doc, { patient, session, updatedAt }, y) {
  const bits = [];
  if (patient?.name) bits.push(`Paciente: ${patient.name}`);
  if (session?.date && session?.time) bits.push(`Sesión: ${session.date} · ${session.time}`);
  if (updatedAt) {
    try {
      const d = new Date(updatedAt);
      bits.push(`Actualizada: ${d.toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric" })}`);
    } catch { /* ignore bad timestamp */ }
  }
  if (bits.length === 0) return y;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  setColor(doc, COLORS.charcoalMd);
  const line = bits.join("   ·   ");
  const pageWidth = doc.internal.pageSize.getWidth();
  const wrapped = doc.splitTextToSize(line, pageWidth - PAGE.margin * 2);
  for (const w of wrapped) {
    y = addPageBreakIfNeeded(doc, y, 5);
    doc.text(w, PAGE.margin, y);
    y += 4.5;
  }
  return y + 4;
}

function drawPlaceholder(doc, message, y) {
  doc.setFont("helvetica", "italic");
  doc.setFontSize(9);
  setColor(doc, COLORS.charcoalXl);
  y = addPageBreakIfNeeded(doc, y, 5);
  doc.text(message, PAGE.margin, y);
  return y + 6;
}

async function drawImage(doc, image, y) {
  const pageWidth = doc.internal.pageSize.getWidth();
  const maxWidth = pageWidth - PAGE.margin * 2;
  const { dataUrl, mime, width: storedW, height: storedH } = image;

  // HEIC / HEIF — jsPDF can't render either, so calling addImage
  // would throw and the catch below would silently drop the image
  // with no visible cue. Surface a placeholder instead so the
  // reader knows something's missing.
  if (mime && /^image\/(heic|heif)$/i.test(mime)) {
    return drawPlaceholder(doc, "[imagen HEIC no soportada en PDF]", y);
  }

  // Probe only when the upload-time dimensions are missing (older
  // rows pre-Phase-5-fixes don't have width/height). Avoids the
  // double-decode for newer attachments.
  let probeW = storedW;
  let probeH = storedH;
  if (!probeW || !probeH) {
    const probe = await new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
      img.onerror = () => resolve(null);
      img.src = dataUrl;
    });
    if (!probe || !probe.w || !probe.h) return drawPlaceholder(doc, "[imagen no disponible]", y);
    probeW = probe.w;
    probeH = probe.h;
  }

  // mm-per-pixel arbitrary scale: cap at 80mm wide, scale down to
  // fit the page width with margin, preserve aspect ratio.
  const widthMm = Math.min(maxWidth, 80);
  const heightMm = (widthMm * probeH) / probeW;
  y = addPageBreakIfNeeded(doc, y, heightMm + 6);
  // Format detection from the data URL prefix. jsPDF accepts JPEG,
  // PNG, WEBP.
  let fmt = "JPEG";
  if (/^data:image\/png/i.test(dataUrl)) fmt = "PNG";
  else if (/^data:image\/webp/i.test(dataUrl)) fmt = "WEBP";
  try {
    doc.addImage(dataUrl, fmt, PAGE.margin, y, widthMm, heightMm);
  } catch {
    // jsPDF throws on a few exotic encodings (progressive JPEG
    // variants in older builds, mismatched format hints). Surface
    // a placeholder so the export doesn't have a silent gap.
    return drawPlaceholder(doc, "[imagen no disponible]", y);
  }
  return y + heightMm + 4;
}

async function drawBody(doc, lines, y, { resolvedImages }) {
  const pageWidth = doc.internal.pageSize.getWidth();
  const maxWidth = pageWidth - PAGE.margin * 2;
  let imagesRendered = 0;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];

    // Image references in this line — usually exactly one (our
    // editor inserts them on their own line), but handle the
    // multi-ref case so a markdown-pasted note doesn't silently
    // drop the 2nd+ image.
    const refs = extractAttachmentRefs(raw);
    if (refs.length > 0) {
      for (const ref of refs) {
        if (imagesRendered >= MAX_INLINE_IMAGES) {
          y = drawPlaceholder(doc, "[imagen omitida — máximo 10 por PDF]", y);
          continue;
        }
        const image = resolvedImages.get(ref.id);
        if (image) {
          y = await drawImage(doc, image, y);
          imagesRendered += 1;
        } else {
          y = drawPlaceholder(doc, "[imagen no disponible]", y);
        }
      }
      continue;
    }

    const token = tokenizeLine(raw);

    // Headings get bigger type + heavier weight. Same scale step
    // as the in-app editor's CSS so the export feels familiar.
    let lineHeight = 5.4;
    let fontSize = 10;
    let leftPad = 0;
    let bulletPrefix = "";
    let prefixWidth = 0;

    if (token.block === "h1") { fontSize = 18; lineHeight = 8; }
    else if (token.block === "h2") { fontSize = 14; lineHeight = 7; }
    else if (token.block === "h3") { fontSize = 12; lineHeight = 6; }
    else if (token.block === "ul") {
      bulletPrefix = "•  ";
      leftPad = token.indent * 1.4;
    } else if (token.block === "ol") {
      bulletPrefix = `${token.listMarker || "1."}  `;
      leftPad = token.indent * 1.4;
    } else if (token.block === "task") {
      bulletPrefix = token.taskChecked ? "☑  " : "☐  ";
      leftPad = token.indent * 1.4;
    }

    // Blank paragraph → vertical breathing room only.
    if (token.block === "p" && (!token.inline || token.inline.length === 0)) {
      y += lineHeight * 0.6;
      continue;
    }

    doc.setFontSize(fontSize);
    if (token.block === "h1" || token.block === "h2" || token.block === "h3") {
      doc.setFont("helvetica", "bold");
      setColor(doc, COLORS.charcoal);
    } else {
      doc.setFont("helvetica", "normal");
      setColor(doc, COLORS.charcoal);
    }

    // Bullet / number / checkbox decorator. We render it as plain
    // helvetica so the unicode glyphs (☐ ☑ •) render reliably.
    let renderX = PAGE.margin + leftPad;
    if (bulletPrefix) {
      doc.text(bulletPrefix, renderX, y);
      prefixWidth = doc.getTextWidth(bulletPrefix);
      renderX += prefixWidth;
    }

    const segments = tokenInlineToSegments(token.inline);
    const before = y;
    y = renderInlineSegments(doc, segments, renderX, y, maxWidth - leftPad - prefixWidth, lineHeight);
    // Move below this paragraph.
    y += lineHeight;
    y = addPageBreakIfNeeded(doc, y, lineHeight);

    // Tighter spacing after headings — they already had a larger
    // line height.
    if (token.block === "h1" || token.block === "h2" || token.block === "h3") {
      y += 1;
    }

    // Silence unused-var lint without losing the variable for future
    // line-spacing tweaks based on growth from `before` to `y`.
    void before;
  }
  return y;
}

function drawFooter(doc, { therapistName, now }) {
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const total = doc.internal.getNumberOfPages();
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  setColor(doc, COLORS.charcoalXl);
  const generatedAt = now.toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric" });
  const left = therapistName
    ? `${therapistName}  ·  cardigan.mx`
    : "cardigan.mx";
  for (let p = 1; p <= total; p++) {
    doc.setPage(p);
    doc.text(`Generado el ${generatedAt}`, PAGE.margin, pageHeight - 10);
    doc.text(left, pageWidth - PAGE.margin, pageHeight - 10, { align: "right" });
  }
}

/* Public API — see module header. */
export async function buildNotePdf({
  note,
  attachments = [],
  patient = null,
  session = null,
  therapistName = "",
  imageResolver = null,
  now = new Date(),
}) {
  if (!note) throw new Error("buildNotePdf: note is required");

  // Resolve images up-front so the renderer is purely synchronous.
  // We pick the FIRST MAX_INLINE_IMAGES references by BODY ORDER,
  // not by attachments-array order — otherwise a note that
  // references attachments out of upload order could end up with
  // the wrong subset rendered + "no disponible" placeholders for
  // the ones the user actually wanted to see.
  const resolvedImages = new Map();
  if (imageResolver) {
    const lines = (note.content || "").split("\n");
    const orderedIds = [];
    const seen = new Set();
    for (const line of lines) {
      for (const ref of extractAttachmentRefs(line)) {
        if (seen.has(ref.id)) continue;
        seen.add(ref.id);
        orderedIds.push(ref.id);
      }
    }
    const attachmentsById = new Map((attachments || []).map(a => [a.id, a]));
    const eligible = orderedIds
      .slice(0, MAX_INLINE_IMAGES)
      .map(id => attachmentsById.get(id))
      .filter(Boolean);
    await Promise.all(eligible.map(async (a) => {
      try {
        const dataUrl = await imageResolver(a);
        if (dataUrl) {
          resolvedImages.set(a.id, {
            dataUrl,
            mime: a.mime,
            width: a.width,
            height: a.height,
          });
        }
      } catch { /* skip — placeholder will render */ }
    }));
  }

  const doc = new jsPDF({ unit: PAGE.unit, format: PAGE.format });
  let y = drawHeader(doc, { therapistName });
  y = drawTitle(doc, note.title, y);
  y = drawMetadata(doc, { patient, session, updatedAt: note.updated_at }, y);

  const lines = (note.content || "").split("\n");
  await drawBody(doc, lines, y, { resolvedImages });

  drawFooter(doc, { therapistName, now });
  return doc;
}

function slugifyForFilename(s) {
  return String(s || "nota")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 60) || "nota";
}

/* Convenience downloader — builds + .save()s in one call with a
   slugged filename. Returns the jsPDF instance in case the caller
   wants to keep working with it. */
export async function downloadNotePdf(args) {
  const doc = await buildNotePdf(args);
  const slug = slugifyForFilename(args.note?.title);
  doc.save(`Cardigan-${slug}.pdf`);
  return doc;
}
