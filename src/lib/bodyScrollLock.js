/* ── Global body-scroll lock ──────────────────────────────────────────
   Locks the document body from scrolling while any modal-style
   overlay is mounted. The user reported that scrolling inside an
   open sheet bled through to the page underneath — visually weird
   and easy to mistakenly dismiss state by scrolling the wrong
   thing.

   How it works:
     1. installBodyScrollLock() attaches a MutationObserver to
        document.body that counts elements with the overlay-class
        denylist below.
     2. When the count crosses 0 → N, we snapshot window.scrollY,
        pin the body in place via position:fixed + top:-Y, and add
        an "is-scroll-locked" class so any future CSS that wants to
        react can. iOS Safari needs the position:fixed trick; just
        overflow:hidden lets the body rubber-band.
     3. When the count crosses N → 0, we unwind the inline styles
        and window.scrollTo back to the snapshot — preserving the
        user's read position.

   Why a global observer (vs per-sheet hook):
     - Cardigan has ~19 sheet usages across screens + components.
       Adding a hook to each is tedious and easy to forget on a
       new sheet. The DOM-level observer is zero-touch for all
       existing sheets and any future ones that follow the
       .sheet-overlay / .confirm-dialog-overlay convention.
     - The class-name list is the single source of truth and lives
       here next to the lock logic.

   Idempotent: install can be called multiple times; only the first
   call wires up. */

const OVERLAY_SELECTORS = [
  ".sheet-overlay",
  ".confirm-dialog-overlay",
  // Drawer is a slide-in side panel, not a modal — but its overlay
  // covers the page and benefits from the same lock so the body
  // doesn't scroll behind it on iOS.
  ".drawer-overlay",
];

let installed = false;
let observer = null;
let lockedScrollY = 0;
let isLocked = false;

function countOverlays() {
  let n = 0;
  for (const sel of OVERLAY_SELECTORS) {
    n += document.querySelectorAll(sel).length;
  }
  return n;
}

function lockBody() {
  if (isLocked) return;
  isLocked = true;
  lockedScrollY = window.scrollY || window.pageYOffset || 0;
  // Capture-and-pin is the only reliable cross-browser pattern. iOS
  // Safari ignores `overflow: hidden` on body for touch scrolling;
  // position:fixed actually blocks it. The downside is the page
  // jumps to top when locked — we counter that by translating with
  // `top: -<scrollY>` so the visual position stays put.
  const body = document.body;
  body.style.position = "fixed";
  body.style.top = `-${lockedScrollY}px`;
  body.style.left = "0";
  body.style.right = "0";
  body.style.width = "100%";
  body.classList.add("is-scroll-locked");
}

function unlockBody() {
  if (!isLocked) return;
  isLocked = false;
  const body = document.body;
  body.style.position = "";
  body.style.top = "";
  body.style.left = "";
  body.style.right = "";
  body.style.width = "";
  body.classList.remove("is-scroll-locked");
  // Restore the user's read position. The scrollTo runs before any
  // queued work, so it lands the same frame the lock unwinds.
  window.scrollTo(0, lockedScrollY);
}

function reconcile() {
  const n = countOverlays();
  if (n > 0 && !isLocked) lockBody();
  else if (n === 0 && isLocked) unlockBody();
}

export function installBodyScrollLock() {
  if (installed) return;
  if (typeof document === "undefined") return; // SSR guard
  installed = true;
  // Initial check in case overlays mounted before install.
  reconcile();
  observer = new MutationObserver(() => reconcile());
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    // Class changes don't matter for our selectors — we count
    // presence, not state — but cheap to watch in case a sheet
    // toggles its className later.
    attributes: false,
  });
}

// Test/teardown helper (not used in app code, but cheap to ship).
export function uninstallBodyScrollLock() {
  if (observer) { observer.disconnect(); observer = null; }
  unlockBody();
  installed = false;
}
