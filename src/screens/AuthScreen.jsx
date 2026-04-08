import { useState } from "react";
import { LogoMark } from "../components/LogoMark";

export function AuthScreen() {
  const [mode, setMode] = useState("login");
  return (
    <div className="auth-screen">
      <div className="auth-header">
        <LogoMark size={36} />
        <div className="auth-wordmark">cardigan</div>
        <div className="auth-tagline">Gestiona tu práctica. Sin complicaciones.</div>
      </div>
      <div className="auth-body">
        <div className="auth-toggle">
          <button className={`auth-tab ${mode==="login"?"active":""}`} onClick={()=>setMode("login")}>Entrar</button>
          <button className={`auth-tab ${mode==="signup"?"active":""}`} onClick={()=>setMode("signup")}>Crear cuenta</button>
        </div>
        {mode==="signup" && (
          <div className="input-group">
            <label className="input-label">Nombre completo</label>
            <input className="input" placeholder="Daniela Kim" type="text" autoComplete="name" />
          </div>
        )}
        <div className="input-group">
          <label className="input-label">Correo electrónico</label>
          <input className="input" placeholder="tu@correo.com" type="email" autoComplete="email" inputMode="email" />
        </div>
        <div className="input-group">
          <label className="input-label">Contraseña</label>
          <input className="input" placeholder="••••••••" type="password" autoComplete={mode==="login"?"current-password":"new-password"} />
        </div>
        {mode==="login" && (
          <div style={{ textAlign:"right", marginBottom:18, marginTop:-6 }}>
            <button className="btn btn-ghost" style={{ height:36,fontSize:13,color:"var(--teal-dark)" }}>¿Olvidaste tu contraseña?</button>
          </div>
        )}
        <button className="btn btn-primary">{mode==="login" ? "Entrar a Cardigan" : "Crear mi cuenta"}</button>
        {mode==="signup" && (
          <div style={{ textAlign:"center",fontSize:12,color:"var(--charcoal-xl)",marginTop:14,lineHeight:1.6 }}>
            Al registrarte aceptas los <span style={{ color:"var(--teal-dark)",fontWeight:700 }}>Términos</span> y la <span style={{ color:"var(--teal-dark)",fontWeight:700 }}>Política de privacidad</span>.
          </div>
        )}
      </div>
    </div>
  );
}
