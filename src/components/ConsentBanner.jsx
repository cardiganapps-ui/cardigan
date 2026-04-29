import { useEffect, useState } from "react";
import { supabase } from "../supabaseClient";
import { POLICY_VERSION } from "../data/privacy";

const LS_KEY = "cardigan.consent.v";

/* ── LFPDPPP consent capture ──
   Blocks the app on first login (or after a policy version bump) until
   the user accepts the current aviso de privacidad. The acceptance is
   stored both locally (snappy UX on re-visits) and server-side via
   /api/record-consent (durable audit trail in user_consents).

   On mount we check localStorage first (synchronous, no flash). If
   localStorage doesn't have the current version we then query
   `user_consents` server-side before deciding whether to show the
   banner — that way Safari's ITP cache eviction (~7 days for non-PWA
   sites), a new device / browser, or a wiped local profile don't
   re-prompt a user who has already consented to this version on the
   server. The server is the source of truth; localStorage is just a
   first-paint optimization.

   Only renders when `session` is truthy — we don't need consent before
   sign-in. Returns null once dismissed for the active version. */
export default function ConsentBanner({ user, onAccepted }) {
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState("");
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!user) { setVisible(false); return; }
    let cancelled = false;
    // Safari Private Mode and iOS Lockdown Mode can throw on storage
    // access. Treat any failure as "not yet accepted" so the banner
    // still surfaces (consent capture is mandatory) — server-side
    // user_consents row is the durable record either way.
    let stored = null;
    try { stored = localStorage.getItem(LS_KEY); } catch { /* storage blocked */ }
    if (stored === POLICY_VERSION) {
      // Local cache says we're current — render nothing immediately.
      setVisible(false);
      return;
    }
    // Local cache miss. Don't pop the banner yet — first ask the
    // server whether this user already accepted. This prevents a
    // re-prompt loop on every device change / cookie wipe.
    (async () => {
      try {
        const { data, error: qErr } = await supabase
          .from("user_consents")
          .select("policy_version")
          .eq("user_id", user.id)
          .eq("policy_version", POLICY_VERSION)
          .maybeSingle();
        if (cancelled) return;
        if (!qErr && data?.policy_version === POLICY_VERSION) {
          // Server has the consent. Hydrate localStorage for the next
          // mount and don't surface the banner.
          try { localStorage.setItem(LS_KEY, POLICY_VERSION); } catch { /* ignore */ }
          setVisible(false);
        } else {
          // Either no row, or query failed. In the failure case we
          // err on the side of showing the banner — consent capture
          // is mandatory and a transient network blip shouldn't let
          // a user slip through unconsented. The /api/record-consent
          // upsert is idempotent so a re-accept costs nothing.
          setVisible(true);
        }
      } catch {
        if (!cancelled) setVisible(true);
      }
    })();
    return () => { cancelled = true; };
  }, [user]);

  if (!visible) return null;

  const accept = async () => {
    setAccepting(true);
    setError("");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) throw new Error("Sesión inválida");
      // Cap the request at 15s. Without this, an unreachable server
      // (DNS issue, captive portal, mid-deploy) leaves the user staring
      // at a blocking modal with the spinner spinning forever and no
      // recourse. The error path below surfaces a retry message.
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);
      let res;
      try {
        res = await fetch("/api/record-consent", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ policy_version: POLICY_VERSION }),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeoutId);
      }
      if (!res.ok) {
        let msg = "No se pudo guardar el consentimiento.";
        try { const j = await res.json(); msg = j.error || msg; } catch { /* keep default */ }
        throw new Error(msg);
      }
      // Best-effort cache for snappy re-visits. If storage is blocked
      // (Lockdown / quota), the server-side user_consents row still
      // counts — next mount will hit /api/record-consent again, which
      // is idempotent on (user_id, policy_version).
      try { localStorage.setItem(LS_KEY, POLICY_VERSION); } catch { /* ignore */ }
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
          background: "var(--white)",
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
