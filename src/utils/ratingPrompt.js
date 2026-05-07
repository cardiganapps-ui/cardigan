/* Eligibility predicate for the in-app rating sheet.
   Lives outside RatingSheet.jsx so the component file exports only
   components (Vite's react-refresh/only-export-components rule).

   Returns true when the user is in a window that should see the
   day14 prompt (and hasn't already submitted or dismissed). The
   parent owns the actual `open` state — flipping it from false
   to true based on the value here, then back to false on close. */

export function shouldShowDay14Prompt({ accessState, daysSinceSignup, sessionsCount, patientsCount, hasSubmitted, hasDismissed }) {
  if (accessState !== "trial" && accessState !== "active") return false;
  if (hasSubmitted) return false;
  if (hasDismissed) return false;
  if ((daysSinceSignup || 0) < 14) return false;
  // Need at least one session OR two patients before we ask — otherwise
  // the rating is about onboarding, not the product itself.
  if ((sessionsCount || 0) < 1 && (patientsCount || 0) < 2) return false;
  return true;
}
