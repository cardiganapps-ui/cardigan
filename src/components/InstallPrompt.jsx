import { useState } from "react";
import { IconX } from "./Icons";

function isIOS() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
}

function isStandalone() {
  return window.navigator.standalone === true || window.matchMedia("(display-mode: standalone)").matches;
}

export function InstallPrompt() {
  const dismissed = localStorage.getItem("cardigan-install-dismissed");
  const [visible, setVisible] = useState(!dismissed && isIOS() && !isStandalone());

  if (!visible) return null;

  const dismiss = (permanent) => {
    setVisible(false);
    if (permanent) localStorage.setItem("cardigan-install-dismissed", "1");
  };

  return (
    <div style={{ position:"fixed", bottom:0, left:0, right:0, zIndex:"var(--z-install)", padding:"0 12px 12px", animation:"fadeIn 0.3s ease" }}>
      <div style={{ background:"var(--white)", borderRadius:16, boxShadow:"0 -2px 24px rgba(0,0,0,0.15)", padding:"18px 18px 14px", maxWidth:400, margin:"0 auto" }}>
        <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", gap:10 }}>
          <div style={{ fontFamily:"var(--font-d)", fontSize:15, fontWeight:800, color:"var(--charcoal)", marginBottom:10 }}>
            Instala Cardigan
          </div>
          <button onClick={() => dismiss(false)}
            style={{ background:"none", border:"none", cursor:"pointer", color:"var(--charcoal-xl)", padding:2, flexShrink:0 }}>
            <IconX size={14} />
          </button>
        </div>
        <div style={{ fontSize:13, color:"var(--charcoal-md)", lineHeight:1.6, marginBottom:14 }}>
          Agrega Cardigan a tu pantalla de inicio para acceder más rápido:
        </div>
        <div style={{ display:"flex", flexDirection:"column", gap:10, marginBottom:14 }}>
          <div style={{ display:"flex", alignItems:"center", gap:10 }}>
            <div style={{ width:24, height:24, borderRadius:"50%", background:"var(--teal-pale)", color:"var(--teal-dark)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:12, fontWeight:800, flexShrink:0 }}>1</div>
            <div style={{ fontSize:13, color:"var(--charcoal)" }}>
              Toca el botón <span style={{ display:"inline-flex", verticalAlign:"middle", padding:"1px 5px", fontSize:16 }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--teal)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/>
                </svg>
              </span> de Safari
            </div>
          </div>
          <div style={{ display:"flex", alignItems:"center", gap:10 }}>
            <div style={{ width:24, height:24, borderRadius:"50%", background:"var(--teal-pale)", color:"var(--teal-dark)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:12, fontWeight:800, flexShrink:0 }}>2</div>
            <div style={{ fontSize:13, color:"var(--charcoal)" }}>
              Selecciona <strong>"Agregar a Inicio"</strong>
            </div>
          </div>
        </div>
        <button onClick={() => dismiss(true)}
          style={{ width:"100%", padding:"10px", fontSize:12, fontWeight:600, color:"var(--charcoal-xl)", background:"none", border:"none", cursor:"pointer", fontFamily:"var(--font)" }}>
          No volver a mostrar
        </button>
      </div>
    </div>
  );
}
