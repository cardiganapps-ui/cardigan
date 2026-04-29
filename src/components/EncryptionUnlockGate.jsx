import { useState } from "react";
import { PasswordInput } from "./PasswordInput";

/* ── EncryptionUnlockGate ────────────────────────────────────────────
   Blocking modal shown when the user has note encryption enabled but
   hasn't entered their passphrase this session. The rest of the app
   keeps rendering underneath (so users can still use everything that
   doesn't depend on note plaintext) but a "Notas cifradas" banner is
   surfaced here as a soft prompt.

   This component is render-time pure: all state lives in props +
   local input state. The hook owns persistence and crypto. */

export default function EncryptionUnlockGate({ noteCrypto, onSkip }) {
  const [passphrase, setPassphrase] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (!noteCrypto || noteCrypto.status !== "locked") return null;

  const submit = async (e) => {
    e.preventDefault();
    if (!passphrase || submitting) return;
    setSubmitting(true);
    const ok = await noteCrypto.unlock(passphrase);
    setSubmitting(false);
    if (ok) setPassphrase("");
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="enc-unlock-title"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0, 0, 0, 0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 650,
        padding: "16px",
        paddingBottom: "calc(16px + env(safe-area-inset-bottom))",
      }}
    >
      <form
        onSubmit={submit}
        style={{
          background: "var(--white)",
          borderRadius: "var(--radius-lg, 16px)",
          padding: 22,
          maxWidth: 420,
          width: "100%",
          boxShadow: "0 10px 40px rgba(0, 0, 0, 0.18)",
        }}
      >
        <div style={{ width: 32, height: 3, background: "var(--teal)", borderRadius: 100, marginBottom: 16 }} />
        <div id="enc-unlock-title" style={{ fontFamily: "var(--font-d)", fontSize: 22, fontWeight: 800, color: "var(--charcoal)", marginBottom: 8 }}>
          Desbloquear notas
        </div>
        <div style={{ fontSize: 14, color: "var(--charcoal-md)", lineHeight: 1.55, marginBottom: 16 }}>
          Tus notas están cifradas. Ingresa tu contraseña de notas para verlas y editarlas en esta sesión.
        </div>
        <div className="input-group" style={{ marginBottom: 12 }}>
          <label className="input-label">Contraseña de notas</label>
          <PasswordInput
            autoComplete="off"
            autoFocus
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            disabled={submitting}
          />
        </div>
        {noteCrypto.error && (
          <div style={{ fontSize: 13, color: "var(--red)", marginBottom: 12 }}>{noteCrypto.error}</div>
        )}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={!passphrase || submitting}
          >
            {submitting ? "Desbloqueando…" : "Desbloquear"}
          </button>
          {onSkip && (
            <button type="button" className="btn btn-ghost" onClick={onSkip} disabled={submitting}>
              Continuar sin desbloquear
            </button>
          )}
        </div>
        <div style={{ fontSize: 12, color: "var(--charcoal-xl)", marginTop: 14, lineHeight: 1.5 }}>
          ¿Olvidaste tu contraseña? Escribe a privacy@cardigan.mx para recuperar el acceso.
        </div>
      </form>
    </div>
  );
}
