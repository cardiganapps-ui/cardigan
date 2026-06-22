/* ── AdminPage ──────────────────────────────────────────────────────────
   Page-shell primitive. Standardizes vertical rhythm across all 8 admin
   sub-screens: page title + optional subtitle + actions row, optional
   filters slot, and a body that takes one or more <AdminPage.Section>
   children. Replaces ad-hoc <> fragments and hand-rolled headers.

   Composition:

     <AdminPage title="…" subtitle="…" actions={…}>
       <AdminPage.Section title="…">
         <AdminTable … />
       </AdminPage.Section>
     </AdminPage>

   The section primitive renders as a `.admin-page-v2-section` card with
   its own optional sub-header and body. Pass `padded` for forms /
   activity feeds; leave the default for full-bleed tables. */
export function AdminPage({ title, subtitle, actions, filters, children }: {
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  filters?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="admin-page-v2">
      {(title || subtitle || actions) && (
        <header className="admin-page-v2-header">
          <div className="admin-page-v2-header-row">
            <div>
              {title && <h2 className="admin-page-v2-title">{title}</h2>}
              {subtitle && <p className="admin-page-v2-sub">{subtitle}</p>}
            </div>
            {actions && <div className="admin-page-v2-actions">{actions}</div>}
          </div>
        </header>
      )}
      {filters && <div className="admin-page-v2-filters">{filters}</div>}
      <div className="admin-page-v2-body">{children}</div>
    </div>
  );
}

function Section({ title, headerExtra, padded = false, children }: {
  title?: React.ReactNode;
  headerExtra?: React.ReactNode;
  padded?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <section className="admin-page-v2-section">
      {(title || headerExtra) && (
        <div className="admin-page-v2-section-header">
          {title && <h3 className="admin-page-v2-section-title">{title}</h3>}
          {headerExtra}
        </div>
      )}
      <div className={`admin-page-v2-section-body${padded ? " admin-page-v2-section-body--padded" : ""}`}>
        {children}
      </div>
    </section>
  );
}

// Compound component: callers compose <AdminPage.Section>. The static
// property assignment on the exported function keeps the file's only
// export a component (react-refresh stays happy) while TS infers the
// `.Section` member onto AdminPage's type.
AdminPage.Section = Section;
