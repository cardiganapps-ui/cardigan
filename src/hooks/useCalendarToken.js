import { useEffect, useState } from "react";
import { supabase } from "../supabaseClient";

/* Shared "is the iCal feed enabled?" state.

   Background: both the Agenda CTA pill and the CalendarLinkPanel ask
   the same question — does this user already have a calendar token?
   Without sharing state, each surface would fetch independently and
   the Agenda CTA would lag behind the panel after a successful
   enable. Module-level cache + a subscriber set let any surface that
   uses the hook re-render when another surface updates the cache. */

let cache = { token: null, url: "", loaded: false };
let inFlight = null;
const subscribers = new Set();

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
        cache = { token: null, url: "", loaded: true };
        notify();
        return;
      }
      const res = await fetch("/api/calendar-token", {
        headers: { "Authorization": `Bearer ${access}` },
      });
      if (!res.ok) {
        cache = { token: null, url: "", loaded: true };
        notify();
        return;
      }
      const j = await res.json();
      cache = { token: j.token || null, url: j.url || "", loaded: true };
      notify();
    } catch {
      cache = { token: null, url: "", loaded: true };
      notify();
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

/** Imperative setter for after enable / rotate / revoke. */
export function setCalendarToken(token, url) {
  cache = { token: token || null, url: url || "", loaded: true };
  notify();
}

/** Force a refetch — useful after auth state changes. */
export function refreshCalendarToken() {
  cache = { ...cache, loaded: false };
  return fetchToken();
}

export function useCalendarToken() {
  const [state, setState] = useState(cache);
  useEffect(() => {
    subscribers.add(setState);
    if (!cache.loaded && !inFlight) fetchToken();
    return () => subscribers.delete(setState);
  }, []);
  return state;
}
