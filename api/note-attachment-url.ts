import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getR2, BUCKET, getAuthUser, validatePath } from "./_r2.js";
import { withSentry } from "./_sentry.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any;

/* ── Note attachment GET URL ────────────────────────────────────────
   Phase 5 of the Notes premium roadmap. Distinct from
   /api/document-url because:
     • Path namespace is `notes/<userId>/...`, validated separately
       so we never cross the documents/attachments boundary.
     • TTL is 5 min (vs documents' 15) — the client uses the URL
       once-per-mount to populate a Blob URL cache that survives
       re-renders; nothing user-tappable holds a raw signed URL,
       so the shorter window doesn't degrade UX.
     • For encrypted attachments R2 doesn't know the original mime,
       so we let the caller pass `mime` to control the response
       headers; the URL still serves opaque bytes but the client
       can stream them straight into the right Blob constructor.
     • Always `inline; filename=...` — the client either renders
       directly (unencrypted) or fetches + decrypts (encrypted),
       and a forced download would break both flows. */

function safeFilename(path: string) {
  const base = path.split("/").pop() || "attachment";
  return base.replace(/[\r\n";\\]/g, "_").slice(0, 200);
}

async function handler(req: Row, res: Row) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const user = await getAuthUser(req);
    if (!user) return res.status(401).json({ error: "Unauthorized" });

    const { path, mime } = req.body || {};
    if (!validatePath(path, user.id)) {
      return res.status(400).json({ error: "Invalid path" });
    }
    // Caller-supplied mime is reflected back in the signed URL but
    // restricted to image/* + octet-stream so the response can't be
    // turned into an XSS vehicle (text/html, image/svg+xml). Falls
    // back to octet-stream when omitted — safe default.
    let responseType = "application/octet-stream";
    if (typeof mime === "string" && /^(image\/(jpeg|png|webp|heic|heif)|application\/octet-stream)$/.test(mime)) {
      responseType = mime;
    }

    const filename = safeFilename(path);
    const r2 = await getR2();
    const url = await getSignedUrl(r2, new GetObjectCommand({
      Bucket: BUCKET,
      Key: path,
      ResponseContentType: responseType,
      ResponseContentDisposition: `inline; filename="${filename}"`,
    }), { expiresIn: 300 });

    res.status(200).json({ url });
  } catch (err: Row) {
    console.error("[note-attachment-url]", {
      name: err?.name, message: err?.message,
      httpStatus: err?.$metadata?.httpStatusCode,
    });
    res.status(500).json({ error: "Attachment URL generation failed" });
  }
}

export default withSentry(handler, { name: "note-attachment-url" });
