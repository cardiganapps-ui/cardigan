import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getR2, BUCKET, getAuthUser, validatePath } from "./_r2.js";
import { withSentry } from "./_sentry.js";

/* Inline-previewable types — image preview + PDF reader are core UX so
   we keep `inline`. Everything else becomes a download to keep R2 from
   serving HTML/SVG/etc. with whatever Content-Type the original PUT
   set. The overrides below (ResponseContentType / ResponseContentDisposition)
   are part of the signed URL, so the user can't strip or modify them. */
const PREVIEWABLE = new Set([
  "image/jpeg", "image/png", "image/webp", "image/heic", "image/heif",
  "application/pdf",
]);

function inferTypeFromExt(path) {
  const m = /\.([a-z0-9]+)$/i.exec(path);
  if (!m) return "application/octet-stream";
  const ext = m[1].toLowerCase();
  return ({
    jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png",
    webp: "image/webp", heic: "image/heic", heif: "image/heif",
    pdf: "application/pdf", doc: "application/msword",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xls: "application/vnd.ms-excel",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    txt: "text/plain", csv: "text/csv",
  })[ext] || "application/octet-stream";
}

function safeFilename(path) {
  // Strip directory components and quote-unfriendly chars from the
  // basename — it's about to be embedded in a Content-Disposition
  // header value. No newlines, no quotes, no semicolons.
  const base = path.split("/").pop() || "file";
  return base.replace(/[\r\n";\\]/g, "_").slice(0, 200);
}

async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const user = await getAuthUser(req);
    if (!user) return res.status(401).json({ error: "Unauthorized" });

    const { path } = req.body || {};
    if (!validatePath(path, user.id)) {
      return res.status(400).json({ error: "Invalid path" });
    }

    const type = inferTypeFromExt(path);
    const filename = safeFilename(path);
    const disposition = PREVIEWABLE.has(type)
      ? `inline; filename="${filename}"`
      : `attachment; filename="${filename}"`;

    const r2 = await getR2();
    const url = await getSignedUrl(r2, new GetObjectCommand({
      Bucket: BUCKET,
      Key: path,
      ResponseContentType: type,
      ResponseContentDisposition: disposition,
    }), { expiresIn: 900 });

    res.status(200).json({ url });
  } catch (err) {
    console.error("[document-url]", {
      name: err?.name, message: err?.message,
      httpStatus: err?.$metadata?.httpStatusCode,
    });
    res.status(500).json({ error: "Document URL generation failed" });
  }
}

export default withSentry(handler, { name: "document-url" });
