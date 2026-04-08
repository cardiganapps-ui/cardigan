import { useState } from "react";
import { supabase } from "../supabaseClient";
import { LogoMark } from "../components/LogoMark";

export function AuthScreen({ onSignIn, onSignUp }) {
  const [mode, setMode] = useState("login"); // login | signup | reset
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");

  const switchMode = (m) => { setMode(m); setError(""); setMessage(""); };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setMessage("");
    setSubmitting(true);

    if (mode === "reset") {
      if (!email.trim()) { setError("Ingresa tu correo."); setSubmitting(false); return; }
      const { error: err } = await supabase.auth.resetPasswordForEmail(email.trim());
      setSubmitting(false);
      if (err) { setError(err.message); return; }
      setMessage("Revisa tu correo para restablecer tu contraseña.");
      return;
    }

    if (mode === "signup") {
      if (!name.trim()) { setError("Ingresa tu nombre."); setSubmitting(false); return; }
      const result = await onSignUp({ email, password, name: name.trim() });
      setSubmitting(false);
      if (result.error) { setError(result.error); return; }
      setMessage("Revisa tu correo para confirmar tu cuenta.");
      return;
    }

    const result = await onSignIn({ email, password });
    setSubmitting(false);
    if (result.error) { setError(result.error); return; }
  };

  return (
    <div className="auth-screen">
      <div className="auth-header">
        <LogoMark size={36} />
        <div className="auth-wordmark">cardigan</div>
        <div className="auth-tagline">Gestiona tu práctica. Sin complicaciones.</div>
      </div>
      <div className="auth-body">
        {message ? (
          <div style={{ textAlign:"center", paddingTop:20 }}>
            <div style={{ fontFamily:"var(--font-d)", fontSize:18, fontWeight:800, color:"var(--charcoal)", marginBottom:12 }}>Listo</div>
            <div style={{ fontSize:14, color:"var(--charcoal-lt)", lineHeight:1.6, marginBottom:24 }}>{message}</div>
            <button className="btn btn-primary" onClick={() => switchMode("login")}>Ir a iniciar sesión</button>
          </div>
        ) : (
          <>
            {mode !== "reset" && (
              <div className="auth-toggle">
                <button className={`auth-tab ${mode==="login"?"active":""}`} onClick={() => switchMode("login")}>Entrar</button>
                <button className={`auth-tab ${mode==="signup"?"active":""}`} onClick={() => switchMode("signup")}>Crear cuenta</button>
              </div>
            )}
            {mode === "reset" && (
              <div style={{ marginBottom:20 }}>
                <div style={{ fontFamily:"var(--font-d)", fontSize:17, fontWeight:800, color:"var(--charcoal)", marginBottom:6 }}>Restablecer contraseña</div>
                <div style={{ fontSize:13, color:"var(--charcoal-xl)", lineHeight:1.5 }}>Ingresa tu correo y te enviaremos un enlace.</div>
              </div>
            )}
            <form onSubmit={handleSubmit}>
              {mode === "signup" && (
                <div className="input-group">
                  <label className="input-label">Nombre completo</label>
                  <input className="input" placeholder="Tu nombre" type="text" autoComplete="name" value={name} onChange={e => setName(e.target.value)} />
                </div>
              )}
              <div className="input-group">
                <label className="input-label">Correo electrónico</label>
                <input className="input" placeholder="tu@correo.com" type="email" autoComplete="email" inputMode="email" value={email} onChange={e => setEmail(e.target.value)} />
              </div>
              {mode !== "reset" && (
                <div className="input-group">
                  <label className="input-label">Contraseña</label>
                  <input className="input" placeholder="••••••••" type="password" autoComplete={mode==="login"?"current-password":"new-password"} value={password} onChange={e => setPassword(e.target.value)} />
                </div>
              )}
              {error && <div style={{ fontSize:13, color:"var(--red)", marginBottom:12 }}>{error}</div>}
              {mode === "login" && (
                <div style={{ textAlign:"right", marginBottom:14, marginTop:-6 }}>
                  <button type="button" className="btn btn-ghost" style={{ height:36,fontSize:13,color:"var(--teal-dark)" }} onClick={() => switchMode("reset")}>¿Olvidaste tu contraseña?</button>
                </div>
              )}
              <button className="btn btn-primary" type="submit" disabled={submitting}>
                {submitting ? "Cargando..." : mode==="login" ? "Entrar" : mode==="signup" ? "Crear mi cuenta" : "Enviar enlace"}
              </button>
            </form>
            {mode === "reset" && (
              <div style={{ textAlign:"center", marginTop:16 }}>
                <button type="button" className="btn btn-ghost" onClick={() => switchMode("login")}>Volver a iniciar sesión</button>
              </div>
            )}
            {mode === "signup" && (
              <div style={{ textAlign:"center",fontSize:12,color:"var(--charcoal-xl)",marginTop:14,lineHeight:1.6 }}>
                Al registrarte aceptas los <span style={{ color:"var(--teal-dark)",fontWeight:700 }}>Términos</span> y la <span style={{ color:"var(--teal-dark)",fontWeight:700 }}>Política de privacidad</span>.
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
