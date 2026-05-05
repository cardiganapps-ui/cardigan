/* ── AdminHealth ──
   v1 stub. Outbound link tiles to the dashboards we actually use plus
   a brief explanation of what each surface owns. Inline reads from
   Edge Config + cron_state are out of scope this PR. */
const DASHBOARDS = [
  {
    name: "Vercel Deployments",
    sub: "Frontend + serverless function logs",
    href: "https://vercel.com/cardiganapps-ui/cardigan/deployments",
  },
  {
    name: "Supabase",
    sub: "Database, auth, RLS, table editor",
    href: "https://supabase.com/dashboard",
  },
  {
    name: "Sentry",
    sub: "Client + serverless error tracking",
    href: "https://sentry.io/",
  },
  {
    name: "Stripe Dashboard",
    sub: "Subscriptions, invoices, customers",
    href: "https://dashboard.stripe.com/",
  },
  {
    name: "Resend",
    sub: "Transactional email logs",
    href: "https://resend.com/",
  },
  {
    name: "Cloudflare DNS",
    sub: "cardigan.mx zone, SSL",
    href: "https://dash.cloudflare.com/",
  },
  {
    name: "Edge Config",
    sub: "cron_paused, signups_paused, whatsapp_paused",
    href: "https://vercel.com/cardiganapps-ui/~/stores",
  },
  {
    name: "GitHub",
    sub: "Repo, PRs, CI",
    href: "https://github.com/cardiganapps-ui/cardigan",
  },
];

export function AdminHealth() {
  return (
    <>
      <div className="admin-card">
        <div className="admin-card-title">Salud del sistema</div>
        <div className="admin-card-sub">
          Atajos a los paneles externos donde se monitorea Cardigan.
          Para una caída, empieza por Sentry y los logs de la función
          afectada en Vercel.
        </div>
        <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
          {DASHBOARDS.map((d) => (
            <a key={d.name} href={d.href} target="_blank" rel="noopener noreferrer"
              style={{
                display: "block",
                padding: "12px 14px",
                borderRadius: "var(--radius)",
                border: "1px solid var(--border-lt)",
                background: "var(--cream)",
                textDecoration: "none",
                color: "var(--charcoal)",
                transition: "background-color var(--dur-fast) ease",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "var(--white)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "var(--cream)"; }}>
              <div style={{ fontWeight: 700, fontSize: 13 }}>{d.name} →</div>
              <div style={{ fontSize: 11, color: "var(--charcoal-xl)", marginTop: 2 }}>{d.sub}</div>
            </a>
          ))}
        </div>
      </div>

      <div className="admin-card">
        <div className="admin-card-title">Banderas operativas</div>
        <div className="admin-card-sub">
          Edge Config (cardigan-flags). Los cambios se propagan en segundos sin redeploy.
        </div>
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: "var(--charcoal-md)", lineHeight: 1.6 }}>
          <li><code>cron_paused</code> — pausa el cron de recordatorios.</li>
          <li><code>signups_paused</code> — reservada para cierre de altas en incidente.</li>
          <li><code>whatsapp_paused</code> — pausa la rama WhatsApp; el push sigue.</li>
          <li><code>encryption_setup_enabled</code> — activa/desactiva nuevos cifrados.</li>
        </ul>
      </div>
    </>
  );
}
