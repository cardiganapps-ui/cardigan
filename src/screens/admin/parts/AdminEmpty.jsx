/* ── AdminEmpty ─────────────────────────────────────────────────────────
   Internal-tools empty state. No illustration (illustrations are
   consumer-app vocabulary; admins want signal, not character). Title +
   body + optional CTA, centered, scoped padding.

   Props:
     title:  one-line headline
     body:   one-line explanation (optional)
     cta:    optional ReactNode rendered below body (a button) */
export function AdminEmpty({ title, body, cta }) {
  return (
    <div className="admin-empty-v2" role="status">
      {title && <div className="admin-empty-v2-title">{title}</div>}
      {body && <div className="admin-empty-v2-body">{body}</div>}
      {cta && <div className="admin-empty-v2-cta">{cta}</div>}
    </div>
  );
}
