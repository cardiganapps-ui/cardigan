import { IconHome, IconUsers, IconTag, IconShield, IconMenu } from "../../../components/Icons";
import { useT } from "../../../i18n/index";
import { haptic } from "../../../utils/haptics";

/* ── AdminBottomTabs ────────────────────────────────────────────────────
   Mobile-only (≤900px) bottom tab strip mirroring `BottomTabs.jsx`'s
   vocabulary so the admin shell feels like the consumer app on iPhone.
   Hidden at ≥900px via CSS; desktop keeps the persistent rail.

   Five slots: the four highest-traffic admin sections + "Más" which
   opens the existing hamburger drawer for the long-tail (Ingresos,
   Adquisición, Reportes, Salud).

   Cuts cross-section nav from 2 taps (open drawer → tap item) to 1 on
   phone. */
const TABS = [
  { key: "overview", Icon: IconHome,   labelKey: "admin.overview.title" },
  { key: "users",    Icon: IconUsers,  labelKey: "admin.users.title" },
  { key: "codes",    Icon: IconTag,    labelKey: "admin.codes.title" },
  { key: "audit",    Icon: IconShield, labelKey: "admin.audit.title" },
];

export function AdminBottomTabs({ section, onChange, onMore, moreActive = false }) {
  const { t } = useT();
  return (
    <>
      <nav className="admin-bottom-tabs" role="tablist" aria-label="Navegación admin">
        {TABS.map((tab) => {
          const active = section === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={active}
              className={`admin-bottom-tab${active ? " admin-bottom-tab--active" : ""}`}
              onClick={() => {
                if (!active) haptic.tap();
                onChange?.(tab.key);
              }}
            >
              <span className="admin-bottom-tab-icon"><tab.Icon size={20} /></span>
              <span className="admin-bottom-tab-label">{t(tab.labelKey)}</span>
            </button>
          );
        })}
        <button
          type="button"
          role="tab"
          aria-selected={moreActive}
          className={`admin-bottom-tab${moreActive ? " admin-bottom-tab--active" : ""}`}
          onClick={() => { haptic.tap(); onMore?.(); }}
        >
          <span className="admin-bottom-tab-icon"><IconMenu size={20} /></span>
          <span className="admin-bottom-tab-label">Más</span>
        </button>
      </nav>
      {/* Fills the iOS PWA home-indicator safe-area with the admin
          surface color so no page content can bleed through during
          scroll bounce. Mirrors `.bottom-tabs-safezone` from the
          consumer app. */}
      <div className="admin-bottom-tabs-safezone" aria-hidden="true" />
    </>
  );
}
