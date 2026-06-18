import { useCallback, useEffect, useState } from "react";
import { supabase } from "../supabaseClient";
import { passkeysAvailable } from "../config/passkeys";

/* ── usePasskeys ──
   Manages WebAuthn passkey enrollment for the signed-in user via
   Supabase Auth's passkey beta. Passkeys are an ADDITIONAL passwordless
   login option (the sign-in ceremony itself lives in useAuth's
   signInWithPasskey, since it runs pre-session); this hook covers the
   authenticated side: listing, adding, and removing passkeys.

   Returns:
     supported:  bool   — passkeys are gated-on AND WebAuthn is available
     loading:    bool   — initial list() fetch in flight
     passkeys:   array of `{ id, friendly_name, created_at }`
     busy:       bool   — a register/delete ceremony is running
     error:      string — surfaced to UI
     register(): run the WebAuthn create ceremony + persist the passkey
     remove(passkeyId): delete a passkey
     refresh():  re-list

   Mirrors useMfa's shape so the Settings security UI reads consistently.
   Every method is a no-op (returns false) when `supported` is false, so
   callers never trip the experimental API on an unsupported surface
   (e.g. the native WebView). */

export function usePasskeys() {
  const supported = passkeysAvailable();
  const [loading, setLoading] = useState(supported);
  const [passkeys, setPasskeys] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    if (!supported) { setLoading(false); return; }
    setLoading(true);
    setError("");
    try {
      const { data, error: err } = await supabase.auth.passkey.list();
      if (err) {
        setError(err.message || "No se pudieron cargar las llaves de acceso");
        setPasskeys([]);
      } else {
        // The beta returns the list either directly as the array or under
        // a `passkeys` key depending on SDK minor — tolerate both.
        setPasskeys(Array.isArray(data) ? data : (data?.passkeys || []));
      }
    } catch (e) {
      setError(e?.message || "No se pudieron cargar las llaves de acceso");
      setPasskeys([]);
    } finally {
      setLoading(false);
    }
  }, [supported]);

  // Initial fetch on mount. refresh() flips loading internally so the
  // MFA-style "…" shows from the first frame.
  useEffect(() => { refresh(); }, [refresh]);

  const register = useCallback(async () => {
    if (!supported || busy) return false;
    setError("");
    setBusy(true);
    try {
      const { error: err } = await supabase.auth.registerPasskey();
      if (err) {
        // A user who dismisses the system passkey sheet yields an
        // AbortError / NotAllowedError — that's a cancel, not a failure
        // to surface as a red banner.
        if (/NotAllowed|AbortError|cancel/i.test(err.name || err.message || "")) {
          return false;
        }
        setError(err.message || "No se pudo crear la llave de acceso");
        return false;
      }
      await refresh();
      return true;
    } catch (e) {
      if (/NotAllowed|AbortError|cancel/i.test(e?.name || e?.message || "")) return false;
      setError(e?.message || "No se pudo crear la llave de acceso");
      return false;
    } finally {
      setBusy(false);
    }
  }, [supported, busy, refresh]);

  const remove = useCallback(async (passkeyId) => {
    if (!supported || !passkeyId) return false;
    setError("");
    setBusy(true);
    try {
      const { error: err } = await supabase.auth.passkey.delete({ passkeyId });
      if (err) {
        setError(err.message || "No se pudo eliminar la llave de acceso");
        return false;
      }
      await refresh();
      return true;
    } catch (e) {
      setError(e?.message || "No se pudo eliminar la llave de acceso");
      return false;
    } finally {
      setBusy(false);
    }
  }, [supported, refresh]);

  return { supported, loading, passkeys, busy, error, register, remove, refresh };
}
