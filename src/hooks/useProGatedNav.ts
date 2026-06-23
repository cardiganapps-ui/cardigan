import { useState, useCallback } from "react";

/* ── useProGatedNav ───────────────────────────────────────────────────
   The Pro-feature upgrade gate + the two sheet-shaped nav targets it
   guards (Cardi, the in-app chatbot) plus the notification inbox. These
   used to live inline in AppShell:

   - requirePro(feature) — centralized "open the upgrade sheet" so any
     screen can prompt without mounting its own copy (the sheet renders
     once at App level via AppOverlays). Trial/expired users land here;
     Pro users (active sub / comp / admin) must short-circuit on
     subscription.isPro before calling.
   - handleDrawerNav(id) — the Drawer routes here so the "cardi" entry can
     gate on isPro (→ open the sheet, or bump to the upgrade sheet);
     every other id is a plain setScreen.

   Cohesive because Cardi is the one nav target that's both Pro-gated and
   sheet-shaped, so its open-state, the upgrade gate, and the drawer
   routing all move together. Inbox rides along — it's the other topbar
   sheet toggled from the same chrome. Guard sets + dep arrays preserved
   exactly. */

export interface ProGatedNavDeps {
  isPro: boolean;
  setScreen: (id: string) => void;
}

export function useProGatedNav({ isPro, setScreen }: ProGatedNavDeps) {
  const [proSheetOpen, setProSheetOpen] = useState(false);
  const [proSheetFeature, setProSheetFeature] = useState<string | null>(null);
  const requirePro = useCallback((feature?: string) => {
    // Trial users + expired users land here. Pro users (active sub,
    // comp, admin) should never see this sheet — callers must short-
    // circuit on `subscription.isPro` before invoking.
    setProSheetFeature(feature || "default");
    setProSheetOpen(true);
  }, []);

  const [cardiOpen, setCardiOpen] = useState(false);
  const [inboxOpen, setInboxOpen] = useState(false);
  const handleDrawerNav = useCallback((id: string) => {
    if (id === "cardi") {
      if (!isPro) {
        requirePro("cardi");
        return;
      }
      setCardiOpen(true);
      return;
    }
    setScreen(id);
  }, [isPro, requirePro, setScreen]);

  return {
    proSheetOpen, setProSheetOpen, proSheetFeature, requirePro,
    cardiOpen, setCardiOpen,
    inboxOpen, setInboxOpen,
    handleDrawerNav,
  };
}
