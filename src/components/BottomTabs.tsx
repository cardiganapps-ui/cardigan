import { useEffect, useRef, useState } from "react";
import { IconHome, IconCalendar, IconUser, IconUsers, IconDollar } from "./Icons";
import { useCardigan } from "../context/CardiganContext";
import { useT } from "../i18n/index";
import { haptic } from "../utils/haptics";
import { syncNativeChrome, releaseNativeChrome } from "../lib/nativeChrome";

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
  { key: "patients", Icon: IconUser,     tKey: "nav.patients" },
  { key: "groups",   Icon: IconUsers,    tKey: "nav.groups" },
  { key: "finances", Icon: IconDollar,   tKey: "nav.finances" },
];

/* SF Symbol analogs of the web icon set — used by the native iOS 26
   Liquid Glass bar (plugins/native-chrome), which renders REAL Apple
   glass instead of this component's CSS approximation. */
const SF_SYMBOLS: Record<string, string> = {
  home: "house",
  agenda: "calendar",
  patients: "person",
  groups: "person.3",
  finances: "dollarsign",
};

export function BottomTabs() {
  const { screen, navigate, groupsEnabled } = useCardigan();
  const { t } = useT();
  const tabs = TABS.filter(tab => tab.key !== "groups" || groupsEnabled !== false);

  // Active index drives the sliding indicator's position via CSS
  // variable. -1 (no match — e.g. user is on Settings or Archivo)
  // hides the indicator entirely via the conditional render below.
  const activeIndex = tabs.findIndex(tab => tab.key === screen);
  const showIndicator = activeIndex >= 0;

  // Native iOS 26+: hand the tab bar to the real Liquid Glass SwiftUI
  // pill and render nothing here. syncNativeChrome resolves false
  // everywhere else (web, Android, iOS < 26, tablet) — the DOM pill
  // stays. The unmount cleanup hides the native bar so hideBottomTabs
  // flows (auth, admin view-as) mirror automatically.
  const [nativeActive, setNativeActive] = useState(false);
  const navigateRef = useRef(navigate);
  useEffect(() => { navigateRef.current = navigate; }, [navigate]);
  useEffect(() => {
    let cancelled = false;
    void syncNativeChrome(
      tabs.map(tab => ({ id: tab.key, title: t(tab.tKey), symbol: SF_SYMBOLS[tab.key] ?? "circle" })),
      activeIndex,
      (id) => navigateRef.current(id),
    ).then(active => { if (!cancelled) setNativeActive(active); });
    return () => { cancelled = true; };
    // `tabs` is rebuilt every render — length captures the real input
    // (the set only changes when groupsEnabled flips).
  }, [tabs.length, activeIndex, t]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => releaseNativeChrome(), []);
  if (nativeActive) return null;

  return (
    <>
      <nav
        className="bottom-tabs"
        aria-label={t("nav.menu")}
        style={{ "--active-i": activeIndex, "--tab-count": tabs.length } as React.CSSProperties}>
        {/* Sliding "active" capsule. One absolutely-positioned element
            that translates between tab slots with --ease-spring —
            visibly smoother than the previous per-tab class swap,
            which painted the capsule instantly at the new position
            with no motion. The transform-via-CSS-variable pattern
            keeps the slide on the compositor (no per-frame React
            renders) and means the indicator's position survives
            re-renders that don't change the active tab. */}
        {showIndicator && <span className="bottom-tab-indicator" aria-hidden="true" />}
        {tabs.map((tab, i) => {
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
              <span className="bottom-tab-icon" aria-hidden="true"><tab.Icon size={22} /></span>
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
