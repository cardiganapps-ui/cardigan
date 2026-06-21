import { useState, useCallback } from "react";
import { supabase } from "../supabaseClient";

/* ── usePatientPay ────────────────────────────────────────────────
   Patient-side companion to /api/patient-create-checkout. Exposes a
   single async action: `pay({ patientId, amountPesos })` that creates
   a Stripe Checkout Session on the therapist's connected account
   and redirects the browser to it.

   Amount is in WHOLE MXN PESOS (matching the patient's mental model
   and `payments.amount`); we convert to cents at the network boundary.

   The hook surfaces { busy, lastError } so the calling sheet can
   render a loading state and an error message without scattering
   fetch state across components. */

export function usePatientPay() {
  const [busy, setBusy] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);

  const pay = useCallback(async ({ patientId, amountPesos }: { patientId: string; amountPesos: number | string }) => {
    setBusy(true);
    setLastError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const access = session?.access_token;
      if (!access) {
        setLastError("not_signed_in");
        return { ok: false };
      }
      const amountCents = Math.round(Number(amountPesos) * 100);
      const res = await fetch("/api/patient-create-checkout", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${access}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ patient_id: patientId, amount_cents: amountCents }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.url) {
        setLastError(data.code || "request_failed");
        return { ok: false, code: data.code, error: data.error };
      }
      // Redirect to the Stripe-hosted Checkout page. The webhook will
      // reconcile on success; the patient lands on /?pago=exito on
      // their way back.
      window.location.href = data.url;
      return { ok: true };
    } catch (err: unknown) {
      const msg = (err as Error)?.message;
      setLastError(msg || "unknown");
      return { ok: false, error: msg };
    } finally {
      setBusy(false);
    }
  }, []);

  return { pay, busy, lastError };
}
