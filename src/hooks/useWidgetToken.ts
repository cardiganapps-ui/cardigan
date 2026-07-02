import { useEffect, useState } from "react";
import { supabase } from "../supabaseClient";

/* Shared "are the iOS widgets provisioned?" state — clone of the
   useCalendarToken module-cache pattern (see that file for the
   rationale). GET /api/widget-token returns metadata only (the DB
   stores just the SHA-256 hash); the plaintext token exists only in
   the POST response, and unlike the calendar URL it's never shown to
   the user — it goes straight into the App Group via WidgetBridge. */

interface WidgetTokenState {
  hasToken: boolean;
  tokenPrefix: string | null;
  createdAt: string | null;
  lastAccessedAt: string | null;
  loaded: boolean;
}

let cache: WidgetTokenState = {
  hasToken: false,
  tokenPrefix: null,
  createdAt: null,
  lastAccessedAt: null,
  loaded: false,
};
let inFlight: Promise<void> | null = null;
const subscribers = new Set<(s: WidgetTokenState) => void>();

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
        cache = { hasToken: false, tokenPrefix: null, createdAt: null, lastAccessedAt: null, loaded: true };
        notify();
        return;
      }
      const res = await fetch("/api/widget-token", {
        headers: { "Authorization": `Bearer ${access}` },
      });
      if (!res.ok) {
        cache = { hasToken: false, tokenPrefix: null, createdAt: null, lastAccessedAt: null, loaded: true };
        notify();
        return;
      }
      const j = await res.json();
      cache = {
        hasToken: !!j.hasToken,
        tokenPrefix: j.tokenPrefix || null,
        createdAt: j.createdAt || null,
        lastAccessedAt: j.lastAccessedAt || null,
        loaded: true,
      };
      notify();
    } catch {
      cache = { hasToken: false, tokenPrefix: null, createdAt: null, lastAccessedAt: null, loaded: true };
      notify();
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

/** Imperative setter for after mint / rotate / revoke. */
export function setWidgetTokenState(payload: { hasToken?: boolean; tokenPrefix?: string | null; createdAt?: string | null; lastAccessedAt?: string | null } | null | undefined) {
  if (!payload || !payload.hasToken) {
    cache = { hasToken: false, tokenPrefix: null, createdAt: null, lastAccessedAt: null, loaded: true };
  } else {
    cache = {
      hasToken: true,
      tokenPrefix: payload.tokenPrefix || null,
      createdAt: payload.createdAt || null,
      lastAccessedAt: payload.lastAccessedAt || null,
      loaded: true,
    };
  }
  notify();
}

/** Force a refetch — the lazy mint in widgetSync can land after the
    panel's first GET, so the panel refreshes on open. */
export function refreshWidgetToken() {
  cache = { ...cache, loaded: false };
  return fetchToken();
}

export function useWidgetToken() {
  const [state, setState] = useState(cache);
  useEffect(() => {
    subscribers.add(setState);
    if (!cache.loaded && !inFlight) fetchToken();
    return () => { subscribers.delete(setState); };
  }, []);
  return state;
}
