/* Eligibility predicate for the in-app rating sheet.
   Lives outside RatingSheet.jsx so the component file exports only
   components (Vite's react-refresh/only-export-components rule).

   Returns true when the user is in a window that should see the
   day14 prompt (and hasn't already submitted or dismissed). The
   parent owns the actual `open` state — flipping it from false
   to true based on the value here, then back to false on close. */

export function shouldShowDay14Prompt({ accessState, daysSinceSignup, sessionsCount, patientsCount, hasSubmitted, hasDismissed, secondsSinceSessionStart }) {
  if (accessState !== "trial" && accessState !== "active") return false;
  if (hasSubmitted) return false;
  if (hasDismissed) return false;
  if ((daysSinceSignup || 0) < 14) return false;
  // Need at least one session OR two patients before we ask — otherwise
  // the rating is about onboarding, not the product itself.
  if ((sessionsCount || 0) < 1 && (patientsCount || 0) < 2) return false;
  // Per-session cooldown: don't ask in the first 5 minutes of a fresh
  // app session. An old account opened from a new device (TestFlight
  // first install, browser-cache clear, sign-out + sign-in) shouldn't
  // immediately get a rating ask — give the user a chance to actually
  // use the app this time before being interrupted. App.jsx passes
  // seconds-since-mount; tests omit it to opt out of this gate.
  if (typeof secondsSinceSessionStart === "number" && secondsSinceSessionStart < 300) return false;
  return true;
}
