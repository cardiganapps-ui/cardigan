import { PutObjectCommand } from "@aws-sdk/client-s3";
import { r2, BUCKET, getAuthUser, validatePath } from "./_r2.js";

/* ── Avatar upload (server-proxied) ──────────────────────────────────
   Unlike documents (which go direct browser → R2 via a presigned URL),
   profile avatars route through this endpoint. Rationale:

   - Avatars are tiny (client resizes to 256² JPEG at q=0.85 → 15–25 KB),
     so the extra hop costs nothing user-visible.
   - Going server-side bypasses two classes of browser-direct-upload
     pitfalls that bit us repeatedly on avatars:
       1. AWS SDK default checksum middleware baking unsigned headers
          into the signed URL (v3.729+ regression).
       2. R2 bucket CORS having to explicitly whitelist every frontend
          origin (cardigan.mx, preview deploys, localhost) with exactly
          the right allowed-headers. Server-side uploads don't care.

   Request body: { path: string, dataUrl: "data:image/jpeg;base64,..." }
   Same `validatePath` guard as the presigned-URL endpoint — path must
   start with the authenticated user's id. */

export const config = { api: { bodyParser: { sizeLimit: "1mb" } } };

const MAX_BYTES = 512 * 1024; // 512 KB post-base64-decode ceiling

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const user = await getAuthUser(req);
    if (!user) return res.status(401).json({ error: "Unauthorized" });

    const { path, dataUrl } = req.body || {};
    if (!validatePath(path, user.id)) {
      return res.status(400).json({ error: "Invalid path" });
    }

    const match = /^data:image\/(jpeg|png);base64,(.+)$/.exec(dataUrl || "");
    if (!match) return res.status(400).json({ error: "Invalid image data" });
    const buffer = Buffer.from(match[2], "base64");
    if (!buffer.length) return res.status(400).json({ error: "Empty image" });
    if (buffer.length > MAX_BYTES) return res.status(413).json({ error: "Too large" });
    const contentType = match[1] === "png" ? "image/png" : "image/jpeg";

    await r2.send(new PutObjectCommand({
      Bucket: BUCKET,
      Key: path,
      Body: buffer,
      ContentType: contentType,
    }));

    res.status(200).json({ ok: true });
  } catch (err) {
    // Log with the full chain; the body is what Vercel tail captures.
    console.error("[upload-avatar] failed:", err?.name, err?.message, err?.$metadata?.httpStatusCode);
    res.status(500).json({ error: "Upload failed" });
  }
}
