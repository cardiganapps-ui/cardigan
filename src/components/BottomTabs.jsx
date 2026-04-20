import { IconHome, IconCalendar, IconUsers, IconDollar } from "./Icons";
import { useCardigan } from "../context/CardiganContext";
import { useT } from "../i18n/index";
import { haptic } from "../utils/haptics";

/* ── Mobile bottom tab bar ──
   Primary navigation for the four most-visited screens (Home, Agenda,
   Patients, Finances). Lives only on mobile (hidden at ≥768px via CSS);
   desktop keeps the sidebar drawer. Secondary destinations (Archivo,
   Settings, Admin) stay in the drawer, which is still reachable via the
   hamburger / edge-swipe. This cuts cross-screen nav from 2 taps (open
   drawer → tap item) to 1. */

const TABS = [
  { key: "home",     Icon: IconHome,     tKey: "nav.home" },
  { key: "agenda",   Icon: IconCalendar, tKey: "nav.agenda" },
  { key: "patients", Icon: IconUsers,    tKey: "nav.patients" },
  { key: "finances", Icon: IconDollar,   tKey: "nav.finances" },
];

export function BottomTabs() {
  const { screen, navigate } = useCardigan();
  const { t } = useT();

  return (
    <>
      <nav className="bottom-tabs" role="tablist" aria-label={t("nav.menu")}>
        {TABS.map(tab => {
          const active = screen === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={active}
              className={`bottom-tab ${active ? "bottom-tab--active" : ""}`}
              onClick={() => {
                if (!active) haptic.tap();
                navigate(tab.key);
              }}>
              <span className="bottom-tab-icon"><tab.Icon size={20} /></span>
              <span className="bottom-tab-label">{t(tab.tKey)}</span>
            </button>
          );
        })}
      </nav>
      {/* Fills the iOS PWA home-indicator safe-area with a solid color
          so no page content can bleed through beneath the tab bar. */}
      <div className="bottom-tabs-safezone" aria-hidden="true" />
    </>
  );
}
