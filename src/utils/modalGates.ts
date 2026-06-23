/* ── Modal-gate eligibility — pure decision helpers ───────────────────
   The one-time prompts the App shell fires (trial reminder, passkey
   enrollment nudge) carried their eligibility logic inline inside
   useEffect blocks in App.tsx, untested. The DECISION (is this user
   eligible to be nudged right now?) is pure; only the localStorage
   reads, setTimeout, and setState are side effects. Pulling the decision
   out here makes the cadence rules testable and the effects thin, and is
   the safe first move before the effects themselves are relocated.

   Constants live here too (single source of truth; App.tsx imports
   them). Each helper takes its thresholds/window as optional params so
   tests can pin them without touching the defaults. */

// Trial-reminder cadence: nudge at 15 / 7 / 1 days left, never more than
// once per calendar day, and never within the plan-sheet grace window.
export const TRIAL_REMINDER_THRESHOLDS = [15, 7, 1];
export const PLAN_SHEET_GRACE_MS = 3 * 24 * 60 * 60 * 1000; // 3 days

// Passkey enrollment-nudge cadence (respectful but persistent): re-ask on
// a later session after a cooldown, capped at a few asks total.
export const PASSKEY_PROMPT_MAX_ASKS = 3;
export const PASSKEY_PROMPT_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000; // 1 week

/** Local calendar-day key ("YYYY-MM-DD"), the once-per-day dedupe unit
    the trial reminder stamps in localStorage. */
export function todayDateKey(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export interface TrialReminderInput {
  demo: boolean;
  viewingAsUser: boolean;       // admin "view as user" read-only mode
  hasUser: boolean;
  accessState: string | null | undefined;
  daysLeft: number | null | undefined;
  planSheetSeenAt: number | null; // ms epoch the plan sheet was last opened (0/null = never)
  lastShownDateKey: string | null; // the stored "last shown" day key
  todayKey: string;
  now: number;                  // ms epoch
  thresholds?: number[];
  graceMs?: number;
}

/** Should the trial-ending reminder modal be shown right now? Mirrors the
    App.tsx gate exactly, minus the side effects. */
export function shouldShowTrialReminder(i: TrialReminderInput): boolean {
  const thresholds = i.thresholds || TRIAL_REMINDER_THRESHOLDS;
  const graceMs = i.graceMs ?? PLAN_SHEET_GRACE_MS;
  if (i.demo || i.viewingAsUser) return false;
  if (!i.hasUser) return false;
  if (i.accessState !== "trial") return false;
  if (typeof i.daysLeft !== "number") return false;
  if (!thresholds.includes(i.daysLeft)) return false;
  // Recently reviewed pricing → don't interrupt again.
  if (i.planSheetSeenAt && i.now - i.planSheetSeenAt < graceMs) return false;
  // Already shown today.
  if (i.lastShownDateKey === i.todayKey) return false;
  return true;
}

export interface PasskeyPromptState {
  n?: number;        // times shown
  t?: number;        // last-shown ms epoch
  enrolled?: boolean; // has a passkey already → never prompt again
}

/** The SYNCHRONOUS half of the passkey-nudge gate (enrolled / cap /
    cooldown). The async hardware + credential-list checks stay in the
    effect; this is the part with the testable cadence rules. */
export function shouldPromptPasskey(
  state: PasskeyPromptState | null | undefined,
  { now, maxAsks = PASSKEY_PROMPT_MAX_ASKS, cooldownMs = PASSKEY_PROMPT_COOLDOWN_MS }: { now: number; maxAsks?: number; cooldownMs?: number },
): boolean {
  const s = state || { n: 0, t: 0, enrolled: false };
  if (s.enrolled) return false;                       // already has one
  const n = s.n || 0;
  if (n >= maxAsks) return false;                     // asked enough, stop
  if (n > 0 && now - (s.t || 0) < cooldownMs) return false; // within cooldown
  return true;
}
