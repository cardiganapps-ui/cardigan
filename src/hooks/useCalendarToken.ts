import { useEffect, useState } from "react";
import { supabase } from "../supabaseClient";

/* Shared "is the iCal feed enabled?" state.

   Background: both the Agenda CTA pill and the CalendarLinkPanel ask
   the same question — does this user already have a calendar token?
   Without sharing state, each surface would fetch independently and
   the Agenda CTA would lag behind the panel after a successful
   enable. Module-level cache + a subscriber set let any surface that
   uses the hook re-render when another surface updates the cache.

   Shape (post-migration 026): the DB stores only a SHA-256 hash of
   the token. GET /api/calendar-token returns metadata (hasToken,
   tokenPrefix, createdAt, lastAccessedAt) but NOT the plaintext URL.
   The plaintext + URL are only available right after POST (rotation),
   stashed in `url` for the panel to display once. After page reload,
   `url` is empty and the panel shows the prefix + "rotate to copy"
   affordance. */

interface CalendarTokenState {
  hasToken: boolean;
  tokenPrefix: string | null;
  createdAt: string | null;
  lastAccessedAt: string | null;
  url: string;
  loaded: boolean;
}

let cache: CalendarTokenState = {
  hasToken: false,
  tokenPrefix: null,
  createdAt: null,
  lastAccessedAt: null,
  url: "", // populated only by setCalendarToken after a fresh POST
  loaded: false,
};
let inFlight: Promise<void> | null = null;
const subscribers = new Set<(s: CalendarTokenState) => void>();

function notify() {
  for (const s of subscribers) s(cache);
}

async function fetchToken() {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const access = session?.access_token;
      if (!access) {
        cache = { hasToken: false, tokenPrefix: null, createdAt: null, lastAccessedAt: null, url: "", loaded: true };
        notify();
        return;
      }
      const res = await fetch("/api/calendar-token", {
        headers: { "Authorization": `Bearer ${access}` },
      });
      if (!res.ok) {
        cache = { hasToken: false, tokenPrefix: null, createdAt: null, lastAccessedAt: null, url: "", loaded: true };
        notify();
        return;
      }
      const j = await res.json();
      cache = {
        hasToken: !!j.hasToken,
        tokenPrefix: j.tokenPrefix || null,
        createdAt: j.createdAt || null,
        lastAccessedAt: j.lastAccessedAt || null,
        url: "", // GET never carries the plaintext URL
        loaded: true,
      };
      notify();
    } catch {
      cache = { hasToken: false, tokenPrefix: null, createdAt: null, lastAccessedAt: null, url: "", loaded: true };
      notify();
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

/** Imperative setter for after enable / rotate. Pass the full POST
    response so the cache picks up the transient URL plus all the
    metadata the next GET would surface. */
export function setCalendarToken(payload: { hasToken?: boolean; tokenPrefix?: string | null; createdAt?: string | null; lastAccessedAt?: string | null; url?: string } | null | undefined) {
  if (!payload || !payload.hasToken) {
    cache = { hasToken: false, tokenPrefix: null, createdAt: null, lastAccessedAt: null, url: "", loaded: true };
  } else {
    cache = {
      hasToken: true,
      tokenPrefix: payload.tokenPrefix || null,
      createdAt: payload.createdAt || null,
      lastAccessedAt: payload.lastAccessedAt || null,
      url: payload.url || "",
      loaded: true,
    };
  }
  notify();
}

/** Force a refetch — useful after auth state changes. */
export function refreshCalendarToken() {
  cache = { ...cache, loaded: false };
  return fetchToken();
}

/* ── Calendar-prompt dismissal (shared) ──────────────────────────────────
   The "link your calendar" nudge surfaces in two places — the Home
   discovery card (CalendarLinkPromptCard) and the slim Agenda CTA pill.
   They share ONE userId-scoped localStorage flag so dismissing it in
   either place hides it everywhere (it's the same nudge). */
const calendarPromptDismissKey = (userId: string | null | undefined) =>
  `cardigan.calendarPrompt.dismissed.${userId || "anon"}`;

export function isCalendarPromptDismissed(userId: string | null | undefined) {
  try { return localStorage.getItem(calendarPromptDismissKey(userId)) === "1"; }
  catch { return false; }
}

export function dismissCalendarPrompt(userId: string | null | undefined) {
  try { localStorage.setItem(calendarPromptDismissKey(userId), "1"); }
  catch { /* private mode / quota — non-fatal */ }
}

export function useCalendarToken() {
  const [state, setState] = useState(cache);
  useEffect(() => {
    subscribers.add(setState);
    if (!cache.loaded && !inFlight) fetchToken();
    return () => { subscribers.delete(setState); };
  }, []);
  return state;
}
