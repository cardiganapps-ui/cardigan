import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { r2, BUCKET, getAuthUser, validatePath } from "./_r2.js";
import { withSentry } from "./_sentry.js";

async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const user = await getAuthUser(req);
    if (!user) return res.status(401).json({ error: "Unauthorized" });

    const { path } = req.body || {};
    if (!validatePath(path, user.id)) {
      return res.status(400).json({ error: "Invalid path" });
    }

    const url = await getSignedUrl(r2, new GetObjectCommand({
      Bucket: BUCKET,
      Key: path,
    }), { expiresIn: 900 });

    res.status(200).json({ url });
  } catch (err) {
    res.status(500).json({ error: "Document URL generation failed" });
  }
}

export default withSentry(handler, { name: "document-url" });
