import { useEffect, useState } from "react";
import { supabase } from "../supabaseClient";
import { POLICY_VERSION } from "../data/privacy";

const LS_KEY = "cardigan.consent.v";

/* ── LFPDPPP consent capture ──
   Blocks the app on first login (or after a policy version bump) until
   the user accepts the current aviso de privacidad. The acceptance is
   stored both locally (snappy UX on re-visits) and server-side via
   /api/record-consent (durable audit trail in user_consents).

   Only renders when `session` is truthy — we don't need consent before
   sign-in. Returns null once dismissed for the active version. */
export default function ConsentBanner({ user, onAccepted }) {
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState("");
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!user) { setVisible(false); return; }
    const stored = localStorage.getItem(LS_KEY);
    setVisible(stored !== POLICY_VERSION);
  }, [user]);

  if (!visible) return null;

  const accept = async () => {
    setAccepting(true);
    setError("");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) throw new Error("Sesión inválida");
      const res = await fetch("/api/record-consent", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ policy_version: POLICY_VERSION }),
      });
      if (!res.ok) {
        let msg = "No se pudo guardar el consentimiento.";
        try { const j = await res.json(); msg = j.error || msg; } catch { /* keep default */ }
        throw new Error(msg);
      }
      localStorage.setItem(LS_KEY, POLICY_VERSION);
      setVisible(false);
      onAccepted?.();
    } catch (err) {
      setError(err.message || "Intenta de nuevo.");
      setAccepting(false);
    }
  };

  const viewPolicy = () => {
    // Open in a new tab so the user doesn't lose the banner context.
    // PrivacyPolicy is available via the hash route too, but accepting
    // from here keeps the blocking flow visible.
    window.open("/#privacy", "_blank", "noopener,noreferrer");
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="consent-title"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0, 0, 0, 0.45)",
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
        zIndex: 600,
        padding: "16px",
        paddingBottom: "calc(16px + env(safe-area-inset-bottom))",
      }}
    >
      <div
        style={{
          background: "var(--bg-card, #fff)",
          borderRadius: "var(--radius-lg, 16px)",
          padding: 20,
          maxWidth: 460,
          width: "100%",
          boxShadow: "0 10px 40px rgba(0, 0, 0, 0.18)",
        }}
      >
        <div style={{ width: 32, height: 3, background: "var(--teal)", borderRadius: 100, marginBottom: 16 }} />
        <div id="consent-title" style={{ fontFamily: "var(--font-d)", fontSize: 20, fontWeight: 800, color: "var(--charcoal)", marginBottom: 10 }}>
          Aviso de privacidad
        </div>
        <div style={{ fontSize: 14, color: "var(--charcoal-md)", lineHeight: 1.55, marginBottom: 16 }}>
          Para continuar usando Cardigan necesitamos tu consentimiento para tratar tus datos
          personales conforme a la LFPDPPP. Tus datos son tuyos y siempre podrás descargarlos o
          eliminar tu cuenta desde Ajustes.
        </div>
        {error && (
          <div style={{ fontSize: 13, color: "var(--red, #c00)", marginBottom: 12 }}>{error}</div>
        )}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <button className="btn btn-primary" type="button" onClick={accept} disabled={accepting}>
            {accepting ? "Guardando…" : "Acepto el aviso"}
          </button>
          <button className="btn btn-ghost" type="button" onClick={viewPolicy}>
            Ver aviso completo
          </button>
        </div>
      </div>
    </div>
  );
}
