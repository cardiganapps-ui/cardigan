import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getR2, BUCKET, getAuthUser, validatePath } from "./_r2.js";
import { withSentry } from "./_sentry.js";

/* ── R2 upload endpoint (two modes) ────────────────────────────────
   One endpoint, two shapes — consolidated to stay under Vercel's
   12-function Hobby-plan limit.

     Mode A (large files, direct browser→R2):
       body: { path, contentType }
       → returns { url: "<presigned PUT URL>" }
       Used by the documents flow for up-to-10MB uploads.

     Mode B (small files, server-proxied):
       body: { path, dataUrl: "data:image/jpeg;base64,..." }
       → returns { ok: true } after uploading to R2 server-side
       Used by the avatar flow (15–25 KB JPEGs). Sidesteps both the
       AWS SDK checksum-middleware regression and the need for R2
       bucket CORS to whitelist every frontend origin — at the cost
       of a single ~30 KB Vercel function invocation.

   validatePath ensures the path starts with the authenticated
   user's id in both modes. */

const MAX_DIRECT_BYTES = 512 * 1024; // post-base64-decode ceiling

/* ── Mode-A MIME allowlist ──
   Mode A (presigned PUT) accepts user-supplied Content-Type, which
   gets baked into the signed URL and becomes the type R2 stores AND
   serves. Without an allowlist, a user could upload `text/html` or
   `image/svg+xml` and then share the presigned GET URL — the victim's
   browser would render those as code. Even though R2's origin is
   isolated from cardigan.mx (so cookies/JWT don't leak), the page
   could still phish the user, mine, or trigger downloads.
   Keep this list narrow and aligned with the document types Cardigan's
   UI actually surfaces. .svg and .html are intentionally excluded. */
const ALLOWED_UPLOAD_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain",
  "text/csv",
]);

async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed", code: "method_not_allowed" });

  try {
    const user = await getAuthUser(req);
    if (!user) return res.status(401).json({ error: "Unauthorized", code: "unauthorized" });

    const { path, contentType, dataUrl } = req.body || {};
    if (!validatePath(path, user.id)) {
      return res.status(400).json({ error: "Invalid path", code: "invalid_path" });
    }

    // ── Mode B: server-proxied upload ──
    if (typeof dataUrl === "string" && dataUrl.length > 0) {
      const match = /^data:image\/(jpeg|png);base64,(.+)$/.exec(dataUrl);
      if (!match) return res.status(400).json({ error: "Invalid image data", code: "invalid_image_data" });
      const buffer = Buffer.from(match[2], "base64");
      if (!buffer.length) return res.status(400).json({ error: "Empty image", code: "empty_image" });
      if (buffer.length > MAX_DIRECT_BYTES) return res.status(413).json({ error: "Too large", code: "too_large" });
      const ct = match[1] === "png" ? "image/png" : "image/jpeg";

      const r2 = await getR2();
      await r2.send(new PutObjectCommand({
        Bucket: BUCKET,
        Key: path,
        Body: buffer,
        ContentType: ct,
      }));

      return res.status(200).json({ ok: true });
    }

    // ── Mode A: presigned URL for direct browser PUT ──
    const ct = typeof contentType === "string" ? contentType : "application/octet-stream";
    if (!ALLOWED_UPLOAD_TYPES.has(ct)) {
      return res.status(415).json({ error: "Unsupported content type", code: "unsupported_type" });
    }

    const r2 = await getR2();
    const url = await getSignedUrl(r2, new PutObjectCommand({
      Bucket: BUCKET,
      Key: path,
      ContentType: ct,
    }), { expiresIn: 300 });

    res.status(200).json({ url });
  } catch (err) {
    const name = err?.name || "Error";
    const http = err?.$metadata?.httpStatusCode;
    const message = err?.message || "";
    console.error("[upload-url] failed:", { name, http, message });
    // Surface a stable code the client can log + a short human hint.
    // These are diagnostic — no stack traces or secrets.
    res.status(500).json({
      error: "Upload failed",
      code: `r2_${name}`.toLowerCase().replace(/[^a-z0-9_]/g, "_"),
      hint: message.slice(0, 200),
      http: http || null,
    });
  }
}

export default withSentry(handler, { name: "upload-url" });
