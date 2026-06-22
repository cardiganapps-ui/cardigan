import { useT } from "../../i18n/index";
import { AdminPage } from "./parts/AdminPage";

/* ── AdminHealth ────────────────────────────────────────────────────────
   v1 stub. Outbound link tiles to the dashboards we actually use plus
   a brief explanation of what each surface owns. Inline reads from
   Edge Config + cron_state are out of scope this PR. */
const DASHBOARDS = [
  {
    nameKey: "admin.health.dashboardVercel",
    subKey: "admin.health.dashboardVercelSub",
    href: "https://vercel.com/cardiganapps-ui/cardigan/deployments",
  },
  {
    nameKey: "admin.health.dashboardSupabase",
    subKey: "admin.health.dashboardSupabaseSub",
    href: "https://supabase.com/dashboard",
  },
  {
    nameKey: "admin.health.dashboardSentry",
    subKey: "admin.health.dashboardSentrySub",
    href: "https://sentry.io/",
  },
  {
    nameKey: "admin.health.dashboardStripe",
    subKey: "admin.health.dashboardStripeSub",
    href: "https://dashboard.stripe.com/",
  },
  {
    nameKey: "admin.health.dashboardResend",
    subKey: "admin.health.dashboardResendSub",
    href: "https://resend.com/",
  },
  {
    nameKey: "admin.health.dashboardCloudflare",
    subKey: "admin.health.dashboardCloudflareSub",
    href: "https://dash.cloudflare.com/",
  },
];

const FLAGS = [
  { code: "cron_paused", desc: "pausa el cron de recordatorios." },
  { code: "signups_paused", desc: "reservada para cierre de altas en incidente." },
  { code: "whatsapp_paused", desc: "pausa la rama WhatsApp; el push sigue." },
  { code: "encryption_setup_enabled", desc: "activa/desactiva nuevos cifrados." },
  { code: "ocr_paused", desc: "pausa OCR de recibos en ExpenseSheet." },
];

export function AdminHealth() {
  const { t } = useT();
  return (
    <AdminPage
      title={t("admin.health.title")}
      subtitle={t("admin.health.subtitle")}
    >
      <AdminPage.Section title={t("admin.health.sectionDashboards")} padded={false}>
        <div
          style={{
            display: "grid",
            gap: 10,
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            padding: 14,
          }}
        >
          {DASHBOARDS.map((d) => (
            <a key={d.nameKey} href={d.href} target="_blank" rel="noopener noreferrer"
              className="admin-link-tile">
              <div className="admin-link-tile-title">{t(d.nameKey)} →</div>
              <div className="admin-link-tile-sub">{t(d.subKey)}</div>
            </a>
          ))}
        </div>
      </AdminPage.Section>

      <AdminPage.Section title={t("admin.health.sectionFlags")} padded>
        <p style={{ margin: "0 0 10px", fontSize: 12.5, color: "var(--admin-text-meta)", lineHeight: 1.5 }}>
          {t("admin.health.flagsDocsBody")}
        </p>
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, color: "var(--admin-text)", lineHeight: 1.7 }}>
          {FLAGS.map((f) => (
            <li key={f.code}>
              <code style={{ fontFamily: "var(--admin-mono)", fontSize: 12, color: "var(--admin-accent)" }}>
                {f.code}
              </code>{" "}
              — {f.desc}
            </li>
          ))}
        </ul>
      </AdminPage.Section>
    </AdminPage>
  );
}
