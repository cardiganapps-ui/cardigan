/* ── AdminBadge ─────────────────────────────────────────────────────────
   Status dot + text pill. The only badge primitive that should appear
   inside `.admin-shell` — replaces the ad-hoc `.badge .badge-green` /
   `.badge .badge-red` mix that the rest of the consumer app uses. Tones
   pull from --admin-* palette so the badge cluster reads as a single
   family at admin density (10px dot + 11.5px text).

   Props:
     tone:  "neutral" | "success" | "warn" | "danger" | "info" | "brand" | "ghost"
            (default: "neutral")
     children: label text
     dot:   false  — strip the leading dot (use for "ghost" outline pills) */
export function AdminBadge({ tone = "neutral", dot = true, children, title }) {
  const cls = `admin-badge-v2 admin-badge-v2--${tone}${dot ? "" : " admin-badge-v2--no-dot"}`;
  return (
    <span className={cls} title={title}>{children}</span>
  );
}
