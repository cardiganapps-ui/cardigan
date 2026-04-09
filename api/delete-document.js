import { DeleteObjectCommand } from "@aws-sdk/client-s3";
import { r2, BUCKET, getAuthUser } from "./_r2.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const user = await getAuthUser(req);
  if (!user) return res.status(401).json({ error: "Unauthorized" });

  const { path } = req.body || {};
  if (!path) return res.status(400).json({ error: "Missing path" });

  // Enforce user can only delete their own files
  if (!path.startsWith(`${user.id}/`)) {
    return res.status(403).json({ error: "Forbidden" });
  }

  await r2.send(new DeleteObjectCommand({
    Bucket: BUCKET,
    Key: path,
  }));

  res.status(200).json({ ok: true });
}
