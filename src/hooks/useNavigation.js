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
    window.location.hash = newScreen;
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
  useEffect(() => {
    const handlePopState = (e) => {
      if (suppressPopState.current) return;

      // If layers are open, close the top one
      if (layerStack.current.length > 0) {
        const layer = layerStack.current.pop();
        layer.closeFn();
        return;
      }

      // Otherwise, sync screen from hash
      const hashScreen = getHashScreen();
      if (hashScreen !== screen) {
        saveScroll(screen);
        const dir = SCREEN_ORDER[hashScreen] > SCREEN_ORDER[screen] ? "left" : "right";
        setDirection(dir);
        setScreen(hashScreen);
        restoreScroll(hashScreen);
        setTimeout(() => setDirection(null), 300);
      }
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [screen]);

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
