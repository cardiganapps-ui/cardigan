import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { useCardiganContextValue } from "../hooks/useCardiganContextValue";

/* The context value is now DERIVED from the assembler that builds it
   (useCardiganContextValue), so the data arrays + mutation actions carry
   their real types (WS-4) instead of the former `Record<string, any>`
   bridge. The two slices mirror the two-context split below; the UI-only
   plumbing callbacks the assembler passes through (navigate / pushLayer /
   modal openers) are still typed as loosely as their deps until those are
   tightened, but every data/accounting field is now concrete. */
type AssemblerReturn = ReturnType<typeof useCardiganContextValue>;
/** Stable Main slice: data arrays, mutation actions, config, stable callbacks. */
export type CardiganMainValue = AssemblerReturn["mainValue"];
/** Fast-changing UI slice: screen / drawerOpen / pendingFabAction / tutorial / theme / notifications. */
export type CardiganUIValue = AssemblerReturn["uiValue"];
/** The full merged value (back-compat `useCardigan()` — Main ∩ UI). */
export type CardiganContextValue = CardiganMainValue & CardiganUIValue;

/* ── Sliced context (WS-2) ────────────────────────────────────────────
   The single 70-key context value used to recompute (and re-render all
   ~107 consumers) on every navigation, because the fast-changing UI
   state (screen / drawerOpen / pendingFabAction / tutorial / theme /
   notifications) lived in the same memoized object as the data arrays +
   stable callbacks.

   It's now split across two contexts:
     • MainContext — data arrays, mutation actions, the stable cross-
       cutting callbacks, config (readOnly / subscription / profession).
       Its value is referentially STABLE across navigation, so a consumer
       reading only `useCardiganMain()` no longer re-renders when the user
       navigates or toggles the drawer.
     • UIContext — the fast-changing navigation / UI state + the nav
       actions that pair with it.

   `useCardigan()` stays as a back-compat hook that merges both, so all
   existing consumers keep working unchanged; screens migrate to the
   granular hooks (`useCardiganMain` / `useCardiganUI`) one at a time to
   claim the re-render win. */
const MainContext = createContext<CardiganMainValue | null>(null);
const UIContext = createContext<CardiganUIValue | null>(null);

/* The provider is dual-mode for a clean, no-big-bang migration:
   • Pass split `mainValue` + `uiValue` (the therapist AppShell) to get
     the granular re-render behavior.
   • Pass a single flat `value` (the patient portal + the test harness) to
     feed the SAME bag to both contexts — back-compat, no key partition
     required. */
export function CardiganProvider({
  value, mainValue, uiValue, children,
}: {
  value?: CardiganContextValue;
  mainValue?: CardiganMainValue;
  uiValue?: CardiganUIValue;
  children: ReactNode;
}) {
  const main = mainValue ?? value ?? null;
  const ui = uiValue ?? value ?? null;
  return (
    <MainContext.Provider value={main}>
      <UIContext.Provider value={ui}>{children}</UIContext.Provider>
    </MainContext.Provider>
  );
}

// Colocating the Providers + consumer hooks in one file is the standard
// React context pattern; splitting just to satisfy fast-refresh would
// fragment the importers.
/* eslint-disable react-refresh/only-export-components */

/** Data arrays, mutation actions, stable callbacks, config. Referentially
    stable across navigation — prefer this in data-display screens. */
export function useCardiganMain(): CardiganMainValue {
  const ctx = useContext(MainContext);
  if (!ctx) throw new Error("useCardiganMain must be used within CardiganProvider");
  return ctx;
}

/** Fast-changing navigation / UI state (screen, drawerOpen, …) + the nav
    actions. Re-renders on navigation — use only where that's expected. */
export function useCardiganUI(): CardiganUIValue {
  const ctx = useContext(UIContext);
  if (!ctx) throw new Error("useCardiganUI must be used within CardiganProvider");
  return ctx;
}

/** Back-compat: the full merged bag (main + ui). Existing consumers keep
    using this; it re-renders on any change in either slice. Migrate to
    useCardiganMain / useCardiganUI to claim the granular re-render win. */
export function useCardigan(): CardiganContextValue {
  const main = useCardiganMain();
  const ui = useCardiganUI();
  return useMemo(() => ({ ...main, ...ui }), [main, ui]);
}
/* eslint-enable react-refresh/only-export-components */
