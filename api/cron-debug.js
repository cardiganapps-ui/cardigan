// TEMPORARY DIAGNOSTIC — delete after rotation is verified.
export default function handler(req, res) {
  const s = process.env.CRON_SECRET || "";
  const auth = req.headers.authorization || "";
  res.status(200).json({
    envSecret: { has: !!s, length: s.length, prefix: s.slice(0, 6), suffix: s.slice(-4) },
    received: {
      method: req.method,
      hasAuthHeader: !!req.headers.authorization,
      authLen: auth.length,
      authPrefix: auth.slice(0, 13),
      authSuffix: auth.slice(-4),
      matchesEnv: auth === `Bearer ${s}`,
    },
  });
}
