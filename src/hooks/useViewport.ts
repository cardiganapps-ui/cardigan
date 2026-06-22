import { useEffect, useState } from "react";

const DESKTOP_QUERY = "(min-width: 1024px)";
/* The 820 threshold made iPad Air portrait (820) and iPad Pro 11
   portrait (834) trigger the Patients split-view layout (sidebar
   240 + list 320 + detail), which left only ~92-110px of content
   inside the patient detail's vertical tab rail. That's the squeeze
   users reported. Bumping the threshold to 1024 gives the patient
   detail surface enough room to render session rows, stat grids,
   etc. comfortably; below 1024 the user gets the desktop side-panel
   overlay (cleaner than the squeezed inline layout). The matching
   CSS .patients-split-view + .notes-page--split breakpoints in
   responsive.css moved to 1024 too. */
const TABLET_SPLIT_QUERY = "(min-width: 1024px)";
const TABLET_QUERY = "(min-width: 768px)";

function matches(query: string): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia(query).matches;
}

export function useViewport() {
  const [isDesktop, setIsDesktop] = useState(() => matches(DESKTOP_QUERY));
  const [isTabletSplit, setIsTabletSplit] = useState(() => matches(TABLET_SPLIT_QUERY));
  const [isTablet, setIsTablet] = useState(() => matches(TABLET_QUERY));

  useEffect(() => {
    const desktopMql = window.matchMedia(DESKTOP_QUERY);
    const tabletSplitMql = window.matchMedia(TABLET_SPLIT_QUERY);
    const tabletMql = window.matchMedia(TABLET_QUERY);
    const onDesktop = () => setIsDesktop(desktopMql.matches);
    const onTabletSplit = () => setIsTabletSplit(tabletSplitMql.matches);
    const onTablet = () => setIsTablet(tabletMql.matches);
    desktopMql.addEventListener("change", onDesktop);
    tabletSplitMql.addEventListener("change", onTabletSplit);
    tabletMql.addEventListener("change", onTablet);
    onDesktop();
    onTabletSplit();
    onTablet();
    return () => {
      desktopMql.removeEventListener("change", onDesktop);
      tabletSplitMql.removeEventListener("change", onTabletSplit);
      tabletMql.removeEventListener("change", onTablet);
    };
  }, []);

  return { isDesktop, isTabletSplit, isTablet, isMobile: !isTablet };
}
