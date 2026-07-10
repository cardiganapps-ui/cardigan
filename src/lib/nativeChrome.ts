/* ── Native Liquid Glass chrome bridge (iOS 26+ only) ──

   WebKit can't render true Liquid Glass (no SVG filters in
   backdrop-filter, no access to Apple's material), so on the native
   iOS app the bottom tab bar is a REAL SwiftUI `glassEffect` pill
   rendered over the WKWebView by plugins/native-chrome. This module
   is the only surface the app talks to:

     syncNativeChrome(tabs, activeIndex, onSelect) — called from
       BottomTabs on every render while it's mounted. First call
       configures the native bar and resolves whether native chrome is
       ACTIVE (iOS 26+, phone-width). Subsequent calls diff-sync.
     releaseNativeChrome() — called when BottomTabs unmounts
       (hideBottomTabs flows, auth screen): hides the native bar.

   Policy lives HERE, not in Swift:
   - Availability: native iOS + plugin present + iOS 26+ + phone width
     (≥768px uses the persistent sidebar — no pill anywhere).
   - Overlay coverage: the native bar floats above ALL web content, so
     any web overlay that would cover the pill area (sheets, expediente,
     note editor, doc viewer, ⌘K, FAB menu, confirm dialogs, tutorial,
     the nav drawer) must hide it. A MutationObserver watches for those
     surfaces — same reactive-to-the-DOM approach as the
     `body:has(.sheet-overlay) .bottom-tabs` CSS rule and
     installBodyScrollLock().
   - Scroll-space reservation: html.native-chrome bumps
     --bottom-tabs-h so .page / FAB clear the native bar. The bar is
     56pt + 8pt offset = 64pt; the webview runs `zoom: 0.80`
     (base.css), so 64pt ÷ 0.8 = 80 CSS px. */

import { registerPlugin } from "@capacitor/core";
import { isNative, isIOS } from "./platform";

export interface NativeChromeTab {
  id: string;
  title: string;
  symbol: string;
}

interface NativeChromePluginI {
  isAvailable(): Promise<{ available: boolean }>;
  configure(opts: { tabs: NativeChromeTab[]; activeIndex: number }): Promise<void>;
  setActive(opts: { index: number }): Promise<void>;
  setVisible(opts: { visible: boolean }): Promise<void>;
  setStyle(opts: { dark: boolean }): Promise<void>;
  teardown(): Promise<void>;
  addListener(
    event: "tabSelected",
    cb: (e: { index: number; id: string }) => void,
  ): Promise<{ remove: () => Promise<void> }>;
}

const plugin: NativeChromePluginI | null =
  isNative() && isIOS() ? registerPlugin<NativeChromePluginI>("NativeChrome") : null;

/* Web surfaces that occupy (or scrim over) the pill zone. The native
   bar sits above every one of them in the compositor, so it hides
   while any is mounted. `.drawer` is mounted permanently and toggles
   pointer-events inline — handled separately in evaluate(). */
const COVERING_SELECTOR = [
  ".sheet-overlay:not(.sheet-overlay--exit)",
  ".expediente-open",
  ".note-editor-desktop",
  ".mde-attach-lightbox",
  ".doc-viewer-backdrop",
  ".cmdp-overlay",
  ".fab-overlay",
  ".confirm-dialog-overlay:not(.is-leaving)",
  ".tut-carousel-overlay",
].join(", ");

const state: {
  active: boolean;
  configured: boolean;
  lastActiveIndex: number;
  lastTabsKey: string;
  onSelect: ((id: string) => void) | null;
  cleanups: Array<() => void>;
} = {
  active: false,
  configured: false,
  lastActiveIndex: -2,
  lastTabsKey: "",
  onSelect: null,
  cleanups: [],
};

let availability: Promise<boolean> | null = null;

function checkAvailability(): Promise<boolean> {
  if (!plugin) return Promise.resolve(false);
  if (!availability) {
    availability = plugin
      .isAvailable()
      .then((r) => !!r?.available)
      .catch(() => false);
  }
  return availability;
}

function watchCoveringOverlays(onChange: (covered: boolean) => void): () => void {
  let last: boolean | null = null;
  let raf = 0;
  const evaluate = () => {
    raf = 0;
    let covered = !!document.querySelector(COVERING_SELECTOR);
    if (!covered) {
      const drawer = document.querySelector<HTMLElement>(".drawer");
      // Open drawer = inline pointerEvents "auto" (Drawer.tsx). At
      // ≥768px the drawer is a persistent sidebar, but native chrome
      // never activates there (phone-width gate below).
      if (drawer && drawer.style.pointerEvents === "auto") covered = true;
    }
    if (covered !== last) {
      last = covered;
      onChange(covered);
    }
  };
  const schedule = () => {
    if (!raf) raf = requestAnimationFrame(evaluate);
  };
  const observer = new MutationObserver(schedule);
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["class", "style"],
  });
  schedule();
  return () => {
    observer.disconnect();
    if (raf) cancelAnimationFrame(raf);
  };
}

/** Sync the native bar with the web tab state. Returns whether native
    chrome is active (→ BottomTabs skips rendering the DOM pill). */
export async function syncNativeChrome(
  tabs: NativeChromeTab[],
  activeIndex: number,
  onSelect: (id: string) => void,
): Promise<boolean> {
  if (!plugin) return false;
  if (!(await checkAvailability())) return false;
  // Phone-width only: tablet/desktop uses the persistent sidebar. No
  // live listener — iPhone never crosses 768px and iPad never drops
  // below it, so the boot-time answer is stable for the session.
  if (!window.matchMedia("(max-width: 767px)").matches) return false;

  state.onSelect = onSelect;
  const tabsKey = tabs.map((t) => `${t.id}:${t.title}`).join("|");

  if (!state.configured) {
    state.configured = true;
    state.lastTabsKey = tabsKey;
    state.lastActiveIndex = activeIndex;
    await plugin.configure({ tabs, activeIndex });
    const sub = await plugin.addListener("tabSelected", (e) => {
      state.onSelect?.(e.id);
    });
    state.cleanups.push(() => void sub.remove());
    state.cleanups.push(
      watchCoveringOverlays((covered) => void plugin.setVisible({ visible: !covered })),
    );
  } else if (tabsKey !== state.lastTabsKey) {
    state.lastTabsKey = tabsKey;
    state.lastActiveIndex = activeIndex;
    await plugin.configure({ tabs, activeIndex });
  } else if (activeIndex !== state.lastActiveIndex) {
    state.lastActiveIndex = activeIndex;
    await plugin.setActive({ index: activeIndex });
  }

  if (!state.active) {
    state.active = true;
    document.documentElement.classList.add("native-chrome");
    await plugin.setVisible({ visible: true });
  }
  return true;
}

/** Mirror the APP theme (data-theme, incl. the in-app override) onto
    the native bar: sets the hosting controller's interface style so
    the glass material and glyph colors adapt — the system scheme alone
    is wrong when the user pins a theme in Settings. Called from
    applyStatusBarStyle (nativeBoot.ts) at boot + on every theme
    change; safe no-op everywhere the native bar can't exist. */
export function syncNativeChromeStyle(dark: boolean): void {
  if (!plugin) return;
  void checkAvailability().then((ok) => {
    if (ok) void plugin.setStyle({ dark }).catch(() => {});
  });
}

/** Hide the native bar when the web pill unmounts (hideBottomTabs
    flows, auth screen). Keeps configuration so remount is cheap. */
export function releaseNativeChrome(): void {
  if (!plugin || !state.active) return;
  state.active = false;
  document.documentElement.classList.remove("native-chrome");
  state.cleanups.forEach((fn) => fn());
  state.cleanups = [];
  state.configured = false;
  void plugin.setVisible({ visible: false });
}
