import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { r2, BUCKET, getAuthUser } from "./_r2.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const user = await getAuthUser(req);
  if (!user) return res.status(401).json({ error: "Unauthorized" });

  const { path } = req.body || {};
  if (!path) return res.status(400).json({ error: "Missing path" });

  // Enforce user can only access their own files
  if (!path.startsWith(`${user.id}/`)) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const url = await getSignedUrl(r2, new GetObjectCommand({
    Bucket: BUCKET,
    Key: path,
  }), { expiresIn: 900 }); // 15 min expiry

  res.status(200).json({ url });
}
