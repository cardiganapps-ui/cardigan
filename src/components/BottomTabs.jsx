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

  // Active index drives the sliding indicator's position via CSS
  // variable. -1 (no match — e.g. user is on Settings or Archivo)
  // hides the indicator entirely via the conditional render below.
  const activeIndex = TABS.findIndex(tab => tab.key === screen);
  const showIndicator = activeIndex >= 0;

  return (
    <>
      <nav
        className="bottom-tabs"
        aria-label={t("nav.menu")}
        style={{ "--active-i": activeIndex, "--tab-count": TABS.length }}>
        {/* Sliding "active" capsule. One absolutely-positioned element
            that translates between tab slots with --ease-spring —
            visibly smoother than the previous per-tab class swap,
            which painted the capsule instantly at the new position
            with no motion. The transform-via-CSS-variable pattern
            keeps the slide on the compositor (no per-frame React
            renders) and means the indicator's position survives
            re-renders that don't change the active tab. */}
        {showIndicator && <span className="bottom-tab-indicator" aria-hidden="true" />}
        {TABS.map((tab, i) => {
          const active = screen === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              aria-current={active ? "page" : undefined}
              className={`bottom-tab ${active ? "bottom-tab--active" : ""}`}
              data-tab-i={i}
              onClick={() => {
                if (!active) haptic.tap();
                navigate(tab.key);
              }}>
              <span className="bottom-tab-icon" aria-hidden="true"><tab.Icon size={20} /></span>
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
