// TEMPORARY DIAGNOSTIC — delete after rotation is verified.
export default function handler(req, res) {
  const s = process.env.CRON_SECRET || "";
  res.status(200).json({
    has: !!s,
    length: s.length,
    prefix: s.slice(0, 6),
    suffix: s.slice(-4),
  });
}
