import { DeleteObjectCommand } from "@aws-sdk/client-s3";
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

    await r2.send(new DeleteObjectCommand({
      Bucket: BUCKET,
      Key: path,
    }));

    res.status(200).json({ ok: true });
  } catch (err) {
    // Surface the cause in function logs so an operator can correlate
    // a user "can't delete document" report with the underlying R2
    // failure (permissions, key-not-found, network). withSentry will
    // also report the 5xx response to Sentry for aggregate visibility.
    console.error("[delete-document]", {
      name: err?.name, message: err?.message,
      httpStatus: err?.$metadata?.httpStatusCode,
    });
    res.status(500).json({ error: "Document deletion failed" });
  }
}

export default withSentry(handler, { name: "delete-document" });
