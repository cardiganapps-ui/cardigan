import { DeleteObjectCommand } from "@aws-sdk/client-s3";
import { r2, BUCKET, getAuthUser, validatePath } from "./_r2.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const user = await getAuthUser(req);
    if (!user) return res.status(401).json({ error: "Unauthorized" });

    const { path } = req.body || {};
    if (!validatePath(path, user.id)) {
      return res.status(400).json({ error: "Invalid path" });
    }

    await r2.send(new DeleteObjectCommand({
      Bucket: BUCKET,
      Key: path,
    }));

    res.status(200).json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Document deletion failed" });
  }
}
