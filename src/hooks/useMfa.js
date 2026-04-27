import { useCallback, useEffect, useState } from "react";
import { supabase } from "../supabaseClient";

/* ── useMfa ──
   Manages TOTP factor enrollment via Supabase Auth's MFA API.

   Returns:
     loading: bool — initial factor list fetch in flight
     factors: array of `{ id, friendly_name, status }` (verified only)
     enrollment: null | { id, qr, secret, uri }   ← active enroll session
     error:   string                                ← surfaced to UI
     enroll(): start a new TOTP enrollment; populates `enrollment`
     cancelEnroll(): unenroll the in-progress factor and clear state
     verifyEnroll(code): challenge+verify the in-progress factor
     unenroll(factorId): remove a verified factor (already AAL2)
     refresh():     re-list factors

   Notes:
   - Factor `status` is "unverified" until the user completes a
     challenge. We only return `verified` factors in `factors`.
   - Unenrolling a verified factor requires an AAL2 session — Supabase
     enforces this at the API. Handle the resulting error in the UI. */

export function useMfa() {
  const [loading, setLoading] = useState(true);
  const [factors, setFactors] = useState([]);
  const [enrollment, setEnrollment] = useState(null);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    const { data, error: err } = await supabase.auth.mfa.listFactors();
    if (err) {
      setError(err.message || "Failed to list factors");
      setFactors([]);
    } else {
      setFactors((data?.totp || []).filter(f => f.status === "verified"));
    }
    setLoading(false);
  }, []);

  // Initial fetch triggered on mount. The `setLoading(true)` inside
  // refresh() runs synchronously before the await; the rule warns
  // about cascading renders, but here it's intentional — the UI must
  // show the loading state from the first frame so users don't see a
  // brief "Inactiva" flash for an MFA-enrolled account.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { refresh(); }, [refresh]);

  const enroll = useCallback(async () => {
    setError("");
    const { data, error: err } = await supabase.auth.mfa.enroll({
      factorType: "totp",
      friendlyName: `Cardigan · ${new Date().toISOString().slice(0, 10)}`,
    });
    if (err) { setError(err.message || "Enrollment failed"); return false; }
    setEnrollment({
      id: data.id,
      qr: data.totp?.qr_code || "",
      secret: data.totp?.secret || "",
      uri: data.totp?.uri || "",
    });
    return true;
  }, []);

  const cancelEnroll = useCallback(async () => {
    if (!enrollment?.id) { setEnrollment(null); return; }
    // Best-effort cleanup — if the user bails mid-enrollment we don't
    // want to leave an orphan unverified factor in their account.
    await supabase.auth.mfa.unenroll({ factorId: enrollment.id }).catch(() => {});
    setEnrollment(null);
  }, [enrollment]);

  const verifyEnroll = useCallback(async (code) => {
    if (!enrollment?.id) return false;
    setError("");
    const { data: ch, error: chErr } = await supabase.auth.mfa.challenge({ factorId: enrollment.id });
    if (chErr) { setError(chErr.message || "Challenge failed"); return false; }
    const { error: vErr } = await supabase.auth.mfa.verify({
      factorId: enrollment.id,
      challengeId: ch.id,
      code,
    });
    if (vErr) { setError(vErr.message || "Wrong code"); return false; }
    setEnrollment(null);
    await refresh();
    return true;
  }, [enrollment, refresh]);

  const unenroll = useCallback(async (factorId) => {
    setError("");
    const { error: err } = await supabase.auth.mfa.unenroll({ factorId });
    if (err) { setError(err.message || "Unenroll failed"); return false; }
    await refresh();
    return true;
  }, [refresh]);

  return {
    loading,
    factors,
    enrollment,
    error,
    enroll,
    cancelEnroll,
    verifyEnroll,
    unenroll,
    refresh,
  };
}
