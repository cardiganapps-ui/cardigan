import { useEffect, useState } from "react";

const DESKTOP_QUERY = "(min-width: 1024px)";
const TABLET_SPLIT_QUERY = "(min-width: 820px)";
const TABLET_QUERY = "(min-width: 768px)";

function matches(query) {
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
