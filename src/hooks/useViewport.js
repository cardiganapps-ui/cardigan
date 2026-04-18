import { useEffect, useState } from "react";

const DESKTOP_QUERY = "(min-width: 1024px)";
const TABLET_QUERY = "(min-width: 768px)";

function matches(query) {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia(query).matches;
}

export function useViewport() {
  const [isDesktop, setIsDesktop] = useState(() => matches(DESKTOP_QUERY));
  const [isTablet, setIsTablet] = useState(() => matches(TABLET_QUERY));

  useEffect(() => {
    const desktopMql = window.matchMedia(DESKTOP_QUERY);
    const tabletMql = window.matchMedia(TABLET_QUERY);
    const onDesktop = () => setIsDesktop(desktopMql.matches);
    const onTablet = () => setIsTablet(tabletMql.matches);
    desktopMql.addEventListener("change", onDesktop);
    tabletMql.addEventListener("change", onTablet);
    onDesktop();
    onTablet();
    return () => {
      desktopMql.removeEventListener("change", onDesktop);
      tabletMql.removeEventListener("change", onTablet);
    };
  }, []);

  return { isDesktop, isTablet, isMobile: !isTablet };
}
