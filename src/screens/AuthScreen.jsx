import { useState } from "react";
import { LogoMark } from "../components/LogoMark";

export function AuthScreen({ onSignIn, onSignUp }) {
  const [mode, setMode] = useState("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [signUpDone, setSignUpDone] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);

    if (mode === "signup") {
      if (!name.trim()) { setError("Ingresa tu nombre."); setSubmitting(false); return; }
      const result = await onSignUp({ email, password, name: name.trim() });
      if (result.error) { setError(result.error); setSubmitting(false); return; }
      setSignUpDone(true);
    } else {
      const result = await onSignIn({ email, password });
      if (result.error) { setError(result.error); setSubmitting(false); return; }
    }
    setSubmitting(false);
  };

  if (signUpDone) {
    return (
      <div className="auth-screen">
        <div className="auth-header">
          <LogoMark size={36} />
          <div className="auth-wordmark">cardigan</div>
        </div>
        <div className="auth-body" style={{ textAlign:"center", paddingTop:40 }}>
          <div style={{ fontFamily:"var(--font-d)", fontSize:20, fontWeight:800, color:"var(--charcoal)", marginBottom:12 }}>Revisa tu correo</div>
          <div style={{ fontSize:14, color:"var(--charcoal-lt)", lineHeight:1.6, marginBottom:24 }}>
            Enviamos un enlace de confirmación a <strong>{email}</strong>. Haz clic en el enlace para activar tu cuenta.
          </div>
          <button className="btn btn-primary" onClick={() => { setSignUpDone(false); setMode("login"); }}>
            Ir a iniciar sesión
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-screen">
      <div className="auth-header">
        <LogoMark size={36} />
        <div className="auth-wordmark">cardigan</div>
        <div className="auth-tagline">Gestiona tu práctica. Sin complicaciones.</div>
      </div>
      <div className="auth-body">
        <div className="auth-toggle">
          <button className={`auth-tab ${mode==="login"?"active":""}`} onClick={()=>{ setMode("login"); setError(""); }}>Entrar</button>
          <button className={`auth-tab ${mode==="signup"?"active":""}`} onClick={()=>{ setMode("signup"); setError(""); }}>Crear cuenta</button>
        </div>
        <form onSubmit={handleSubmit}>
          {mode==="signup" && (
            <div className="input-group">
              <label className="input-label">Nombre completo</label>
              <input className="input" placeholder="Tu nombre" type="text" autoComplete="name" value={name} onChange={e => setName(e.target.value)} />
            </div>
          )}
          <div className="input-group">
            <label className="input-label">Correo electrónico</label>
            <input className="input" placeholder="tu@correo.com" type="email" autoComplete="email" inputMode="email" value={email} onChange={e => setEmail(e.target.value)} />
          </div>
          <div className="input-group">
            <label className="input-label">Contraseña</label>
            <input className="input" placeholder="••••••••" type="password" autoComplete={mode==="login"?"current-password":"new-password"} value={password} onChange={e => setPassword(e.target.value)} />
          </div>
          {error && <div style={{ fontSize:13, color:"var(--red)", marginBottom:12 }}>{error}</div>}
          <button className="btn btn-primary" type="submit" disabled={submitting}>
            {submitting ? "Cargando..." : mode==="login" ? "Entrar a Cardigan" : "Crear mi cuenta"}
          </button>
        </form>
        {mode==="signup" && (
          <div style={{ textAlign:"center",fontSize:12,color:"var(--charcoal-xl)",marginTop:14,lineHeight:1.6 }}>
            Al registrarte aceptas los <span style={{ color:"var(--teal-dark)",fontWeight:700 }}>Términos</span> y la <span style={{ color:"var(--teal-dark)",fontWeight:700 }}>Política de privacidad</span>.
          </div>
        )}
      </div>
    </div>
  );
}
