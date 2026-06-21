import { useState, useEffect, useCallback, useRef } from "react";

const VALID_SCREENS = ["home", "agenda", "patients", "groups", "finances", "archivo", "settings", "privacy", "admin"];
// privacy sits "after" settings so the slide direction matches the
// Settings → Aviso de Privacidad → back flow. admin is last — slides
// in from the right when you enter it from anywhere else, slides out
// to the right when you go back home. `groups` sits between patients and
// finances (its bottom-tab position) so the slide direction is intuitive.
const SCREEN_ORDER: Record<string, number> = { home: 0, agenda: 1, patients: 2, groups: 3, finances: 4, archivo: 5, settings: 6, privacy: 7, admin: 8 };

function getHashScreen() {
  // The hash may carry a sub-route (e.g. "#admin/users/<uid>"). The
  // top-level router only knows about the FIRST segment; the
  // remaining segments are parsed by per-screen route hooks (see
  // src/screens/admin/useAdminRoute.js for the admin family). Strip
  // any "?..." search portion first, then split on "/" and take
  // the first segment.
  const raw = window.location.hash.replace("#", "").split("?")[0];
  const top = raw.split("/")[0];
  return VALID_SCREENS.includes(top) ? top : "home";
}

export function useNavigation() {
  const [screen, setScreen] = useState(getHashScreen);
  const [direction, setDirection] = useState<"left" | "right" | null>(null);
  const layerStack = useRef<{ key: string; closeFn: () => void }[]>([]); // [{ key, closeFn }]
  const suppressPopState = useRef(false);
  const scrollPositions = useRef<Record<string, number>>({});
  // Pending direction-clear timer. Tracked so we can cancel it when a
  // second nav happens within the 300ms animation window — without
  // this, the first nav's timer fires mid-second-animation and clears
  // direction, which cuts the slide-in transition. Visible as "the
  // screen pops into place instead of sliding" on rapid tab-tapping.
  const directionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Save/restore scroll ──
  const saveScroll = useCallback((screenId: string) => {
    const page = document.querySelector(".page");
    if (page) scrollPositions.current[screenId] = page.scrollTop;
  }, []);

  const restoreScroll = useCallback((screenId: string) => {
    requestAnimationFrame(() => {
      const page = document.querySelector(".page");
      if (page) page.scrollTop = scrollPositions.current[screenId] || 0;
    });
  }, []);

  // ── Navigate to a main screen ──
  //
  // Uses history.replaceState (not `location.hash = ...`) so that screen
  // changes do NOT add browser history entries. This is intentional: the
  // drawer is the primary navigation surface, and the app's left-edge swipe
  // gesture opens it. If each screen change pushed a history entry, iOS
  // Safari's native edge-swipe-back would trigger history.back() in parallel
  // with our drawer open, firing popstate and teleporting the user to the
  // previous screen at the same time as the drawer opens. Using replaceState
  // means browser back from a main screen exits the app (or closes any open
  // modal, which pushes its own entry via pushLayer) — no in-app navigation
  // conflict. The URL hash still reflects the current screen for deep links
  // and reloads.
  const navigate = useCallback((target: string) => {
    // `target` may be a bare screen name ("home") OR a screen with a
    // sub-path ("admin/users/<uid>"). The top-level router cares only
    // about the first segment for screen identity + slide direction;
    // the rest is parsed by per-screen route hooks (see
    // src/screens/admin/useAdminRoute.js).
    const targetStr = String(target || "");
    const top = targetStr.split("/")[0];
    if (!VALID_SCREENS.includes(top)) return;
    // Allow same-screen sub-route changes (admin/users → admin/codes)
    // even when `top === screen` — the hash has changed even though
    // the React-level screen hasn't, so we still want to write it.
    const sameTop = top === screen;
    if (sameTop && ("#" + targetStr) === window.location.hash) return;
    if (!sameTop) saveScroll(screen);
    // Close all layers first
    while (layerStack.current.length > 0) {
      const layer = layerStack.current.pop();
      layer?.closeFn();
    }
    // Determine direction (only for actual screen changes).
    if (!sameTop) {
      const dir = SCREEN_ORDER[top] > SCREEN_ORDER[screen] ? "left" : "right";
      setDirection(dir);
      setScreen(top);
    }
    suppressPopState.current = true;
    try {
      history.replaceState({ screen: top }, "", "#" + targetStr);
    } catch {
      // Fallback for environments without History API access.
      window.location.hash = targetStr;
    }
    suppressPopState.current = false;
    restoreScroll(top);
    // Cancel any prior timer before scheduling the new one so a second
    // nav within 300ms doesn't get its animation cut short by the
    // first nav's clear-direction firing.
    if (directionTimerRef.current) clearTimeout(directionTimerRef.current);
    directionTimerRef.current = setTimeout(() => {
      directionTimerRef.current = null;
      setDirection(null);
    }, 300);
  }, [screen, saveScroll, restoreScroll]);

  // Cancel the pending direction-clear timer on unmount so it can't
  // fire setDirection against a detached hook (silent in React 19,
  // but still wasted work).
  useEffect(() => () => {
    if (directionTimerRef.current) clearTimeout(directionTimerRef.current);
  }, []);

  // ── Layer stack (modals/overlays) ──
  const pushLayer = useCallback((key: string, closeFn: () => void) => {
    layerStack.current.push({ key, closeFn });
    suppressPopState.current = true;
    history.pushState({ layer: key }, "", window.location.href);
    suppressPopState.current = false;
  }, []);

  const popLayer = useCallback(() => {
    if (layerStack.current.length === 0) return;
    const layer = layerStack.current.pop();
    layer?.closeFn();
  }, []);

  const removeLayer = useCallback((key: string) => {
    layerStack.current = layerStack.current.filter(l => l.key !== key);
  }, []);

  // ── Browser back button ──
  //
  // We only use popstate to close open layers (modals/sheets) that were
  // pushed via pushLayer(). Main screens do NOT push history entries
  // (see navigate() above), so a popstate that arrives while no layer is
  // open means the user is trying to exit the app via back/edge-swipe —
  // we let the browser handle that itself.
  useEffect(() => {
    const handlePopState = () => {
      if (suppressPopState.current) return;
      if (layerStack.current.length > 0) {
        const layer = layerStack.current.pop();
        layer?.closeFn();
      }
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  // ── Hash change sync (for manual URL changes) ──
  useEffect(() => {
    const handleHashChange = () => {
      const hashScreen = getHashScreen();
      if (hashScreen !== screen) {
        setScreen(hashScreen);
      }
    };
    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, [screen]);

  return {
    screen,
    direction, // "left" | "right" | null — for screen transition animation
    navigate,
    pushLayer,
    popLayer,
    removeLayer,
  };
}
