import { useState, useEffect, useCallback, useRef } from "react";

const VALID_SCREENS = ["home", "agenda", "patients", "notes", "documents", "finances", "settings"];
const SCREEN_ORDER = { home: 0, agenda: 1, patients: 2, notes: 3, documents: 4, finances: 5, settings: 6 };

function getHashScreen() {
  const hash = window.location.hash.replace("#", "").split("?")[0];
  return VALID_SCREENS.includes(hash) ? hash : "home";
}

export function useNavigation() {
  const [screen, setScreen] = useState(getHashScreen);
  const [direction, setDirection] = useState(null);
  const layerStack = useRef([]); // [{ key, closeFn }]
  const suppressPopState = useRef(false);
  const scrollPositions = useRef({});

  // ── Save/restore scroll ──
  const saveScroll = useCallback((screenId) => {
    const page = document.querySelector(".page");
    if (page) scrollPositions.current[screenId] = page.scrollTop;
  }, []);

  const restoreScroll = useCallback((screenId) => {
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
  const navigate = useCallback((newScreen) => {
    if (!VALID_SCREENS.includes(newScreen) || newScreen === screen) return;
    saveScroll(screen);
    // Close all layers first
    while (layerStack.current.length > 0) {
      const layer = layerStack.current.pop();
      layer.closeFn();
    }
    // Determine direction
    const dir = SCREEN_ORDER[newScreen] > SCREEN_ORDER[screen] ? "left" : "right";
    setDirection(dir);
    setScreen(newScreen);
    suppressPopState.current = true;
    try {
      history.replaceState({ screen: newScreen }, "", "#" + newScreen);
    } catch {
      // Fallback for environments without History API access.
      window.location.hash = newScreen;
    }
    suppressPopState.current = false;
    restoreScroll(newScreen);
    setTimeout(() => setDirection(null), 300);
  }, [screen]);

  // ── Layer stack (modals/overlays) ──
  const pushLayer = useCallback((key, closeFn) => {
    layerStack.current.push({ key, closeFn });
    suppressPopState.current = true;
    history.pushState({ layer: key }, "", window.location.href);
    suppressPopState.current = false;
  }, []);

  const popLayer = useCallback(() => {
    if (layerStack.current.length === 0) return;
    const layer = layerStack.current.pop();
    layer.closeFn();
  }, []);

  const removeLayer = useCallback((key) => {
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
        layer.closeFn();
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
