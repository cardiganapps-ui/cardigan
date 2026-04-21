/* ── Swipe-gesture coordinator ──

   A tiny module-level arbiter that prevents two horizontal-swipe
   handlers from processing the same finger at once.

   The concrete case it fixes: the left-edge drawer swipe (registered on
   the shell via native addEventListener, App.jsx) and the in-screen
   swipe used for Agenda day/week/month navigation (React synthetic,
   hooks/useSwipe.js) both live on overlapping z-layers. Without a
   coordinator, a finger that touches down near the edge can trigger
   both: the drawer starts sliding in while the Agenda panel strip
   translates right underneath, showing a "screens moving right"
   glitch.

   Contract:
     - Before starting to track a horizontal swipe, call `tryClaim(id)`.
       If another owner already holds the lock, it returns false and
       the caller should abort.
     - When the gesture ends / cancels, call `release(id)` — a no-op
       if the caller doesn't currently own the lock.
     - `isOwnedBy(id)` / `isOwned()` let a handler re-verify mid-
       gesture (useful when the start was cooperative but mid-way
       another subsystem grabbed the lock).

   All callers see the same singleton; ids are string keys chosen by
   each handler (e.g. "drawer-edge", "agenda-swipe"). Idempotent on
   repeat claims from the same owner.

   Also: the left-edge band where the drawer claims gestures is
   exported as DRAWER_EDGE_BAND so any in-screen handler can carve out
   a matching dead zone at start. The coordinator handles the messier
   case of a finger that enters the band mid-drag. */

export const DRAWER_EDGE_BAND = 32;

// In-screen horizontal swipes should use a dead zone bigger than the
// drawer band so a straight-up edge touch never doubles up. We pick
// ~18px of safety (matches the Home carousel's 50 - 32 = 18 gap).
export const IN_SCREEN_SWIPE_DEAD_ZONE = 50;

let _owner = null;

export function tryClaim(id) {
  if (_owner && _owner !== id) return false;
  _owner = id;
  return true;
}

export function release(id) {
  if (_owner === id) _owner = null;
}

export function isOwnedBy(id) {
  return _owner === id;
}

export function isOwned() {
  return _owner !== null;
}

// Test hook — do not use in app code. Lets tests reset state between
// cases without having to exhaustively call release for every owner.
export function __resetForTests() {
  _owner = null;
}
