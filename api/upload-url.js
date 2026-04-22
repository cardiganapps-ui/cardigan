import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { r2, BUCKET, getAuthUser, validatePath } from "./_r2.js";

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

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const user = await getAuthUser(req);
    if (!user) return res.status(401).json({ error: "Unauthorized" });

    const { path, contentType, dataUrl } = req.body || {};
    if (!validatePath(path, user.id)) {
      return res.status(400).json({ error: "Invalid path" });
    }

    // ── Mode B: server-proxied upload ──
    if (typeof dataUrl === "string" && dataUrl.length > 0) {
      const match = /^data:image\/(jpeg|png);base64,(.+)$/.exec(dataUrl);
      if (!match) return res.status(400).json({ error: "Invalid image data" });
      const buffer = Buffer.from(match[2], "base64");
      if (!buffer.length) return res.status(400).json({ error: "Empty image" });
      if (buffer.length > MAX_DIRECT_BYTES) return res.status(413).json({ error: "Too large" });
      const ct = match[1] === "png" ? "image/png" : "image/jpeg";

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

    const url = await getSignedUrl(r2, new PutObjectCommand({
      Bucket: BUCKET,
      Key: path,
      ContentType: ct,
    }), { expiresIn: 300 });

    res.status(200).json({ url });
  } catch (err) {
    console.error("[upload-url] failed:", err?.name, err?.message, err?.$metadata?.httpStatusCode);
    res.status(500).json({ error: "Upload failed" });
  }
}
