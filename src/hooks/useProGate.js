import { useCallback, useState } from "react";
import { useCardigan } from "../context/CardiganContext";

/* ── useProGate ───────────────────────────────────────────────────────
   Helper for screens / components that gate a Pro-only action behind
   the subscription state. Each screen mounts its own ProUpgradeSheet
   bound to this hook; the helper exposes:

     - isPro       — boolean shortcut (sub active | comp | admin)
     - sheetOpen   — controlled state for <ProUpgradeSheet>
     - sheetFeature — which feature's copy to show (documents | encryption | calendar)
     - openSheet(feature) — open the sheet with that feature's copy
     - closeSheet() — close it
     - guard(feature, fn) — convenience: returns a function that calls
       `fn` when isPro is true, otherwise opens the sheet.

   Typical use:
     const pro = useProGate();
     <button onClick={pro.guard("documents", handleUpload)}>Subir</button>
     <ProUpgradeSheet open={pro.sheetOpen} feature={pro.sheetFeature} onClose={pro.closeSheet} /> */
export function useProGate() {
  const { subscription } = useCardigan();
  const isPro = !!subscription?.isPro;
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetFeature, setSheetFeature] = useState(null);

  const openSheet = useCallback((feature) => {
    setSheetFeature(feature || "default");
    setSheetOpen(true);
  }, []);

  const closeSheet = useCallback(() => {
    setSheetOpen(false);
  }, []);

  const guard = useCallback((feature, fn) => {
    // We return a function so the caller can use it directly as an
    // onClick handler. If the user is Pro, we forward whatever args
    // React gave us (event, etc.) to the original fn so behaviour is
    // identical to wiring fn directly.
    return (...args) => {
      if (isPro) return fn?.(...args);
      openSheet(feature);
      return undefined;
    };
  }, [isPro, openSheet]);

  return { isPro, sheetOpen, sheetFeature, openSheet, closeSheet, guard };
}
