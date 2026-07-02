// Orchestrates the app → iOS widget data flow.
//
//   syncWidgets(data)  — called by useCardiganData after every fully
//     successful refresh (same coherence point as saveCachedData).
//     Builds the snapshot with the SAME pure builder the server uses
//     (src/utils/widgetSnapshot.ts) and writes it into the App Group.
//     Also lazily mints the /api/widget-data token on first sync so
//     widgets work out of the box after login — no setup step.
//
//   clearWidgets() — called on sign-out next to clearCachedData. Wipes
//     the App Group so the widgets flip to their "Abre Cardigan para
//     configurar" state and no patient data survives on a logged-out
//     device. The server-side token row is left alone (hash-only,
//     harmless); the next login rotates it.
//
// Everything here is fire-and-forget from the caller's perspective:
// failures degrade to "widgets are stale", never to a visible error.

import { buildWidgetSnapshot } from "../utils/widgetSnapshot";
import { setWidgetSnapshot, setWidgetToken, widgetHasToken, clearWidgetData, widgetBridgeAvailable } from "./widgetBridge";
import { supabase } from "../supabaseClient";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any;

/* Device-level opt-out. "Desactivar widgets" in Settings deletes the
   server token AND sets this flag — without it, the next refresh's
   lazy mint would silently re-enable what the user just turned off.
   Deliberately not user-scoped: it describes THIS device's home
   screen. Known v1 limit: a second iOS device doesn't see the flag,
   so opening the app there re-provisions widgets (documented in the
   Settings copy). */
const WIDGETS_DISABLED_KEY = "cardigan.widgets.disabled";

export function widgetsDisabled(): boolean {
  try { return localStorage.getItem(WIDGETS_DISABLED_KEY) === "1"; }
  catch { return false; }
}

export function setWidgetsDisabled(disabled: boolean): void {
  try {
    if (disabled) localStorage.setItem(WIDGETS_DISABLED_KEY, "1");
    else localStorage.removeItem(WIDGETS_DISABLED_KEY);
  } catch { /* private mode / quota — non-fatal */ }
}

let mintInFlight: Promise<void> | null = null;

async function ensureWidgetToken(): Promise<void> {
  // Single-flight: refresh() can fire in quick succession (cold start +
  // focus refresh) and rotating twice would needlessly break the first
  // token before the widget ever used it.
  if (mintInFlight) return mintInFlight;
  mintInFlight = (async () => {
    try {
      // The App Group already holding a token means this device is set
      // up. Its validity is the extension's concern: on a 404 (revoked /
      // rotated elsewhere) the extension clears the stored copy, which
      // makes this check false on the next app open → re-mint.
      if (await widgetHasToken()) return;
      const { data: { session } } = await supabase.auth.getSession();
      const access = session?.access_token;
      if (!access) return;
      const res = await fetch("/api/widget-token", {
        method: "POST",
        headers: { Authorization: `Bearer ${access}` },
      });
      if (!res.ok) return;
      const j = await res.json();
      if (j?.token) await setWidgetToken(j.token);
    } catch (err) {
      if (import.meta.env.DEV) console.warn("widgetSync.ensureWidgetToken:", (err as Error)?.message || err);
    } finally {
      mintInFlight = null;
    }
  })();
  return mintInFlight;
}

export async function syncWidgets({
  patients,
  sessions,
  payments,
  groups,
}: {
  patients: Row[];
  sessions: Row[];
  payments: Row[];
  groups?: Row[];
}): Promise<void> {
  if (!widgetBridgeAvailable() || widgetsDisabled()) return;
  try {
    // Client session rows carry group_id but not the PostgREST-style
    // groups embed the builder reads for the display name — join it in
    // from the groups state.
    const groupNameById = new Map<string, string>((groups || []).map((g: Row) => [g.id, g.name]));
    const withGroups = (sessions || []).map((s: Row) =>
      s.group_id ? { ...s, groups: { name: groupNameById.get(s.group_id) || null } } : s
    );
    const snapshot = buildWidgetSnapshot({
      sessions: withGroups,
      patients,
      payments,
      tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
    await setWidgetSnapshot(JSON.stringify(snapshot));
    void ensureWidgetToken();
  } catch (err) {
    if (import.meta.env.DEV) console.warn("widgetSync.syncWidgets:", (err as Error)?.message || err);
  }
}

export async function clearWidgets(): Promise<void> {
  if (!widgetBridgeAvailable()) return;
  await clearWidgetData();
}
