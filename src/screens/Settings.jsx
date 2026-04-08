export function Settings() {
  const sections = [
    { label:"Mi práctica", rows:[
      { icon:"👤", bg:"#EAF4F7", title:"Perfil profesional", sub:"Daniela · Psicóloga" },
      { icon:"💱", bg:"#EDF7F2", title:"Moneda y precios",   sub:"MXN — Peso Mexicano" },
      { icon:"🔔", bg:"#FDF6E8", title:"Recordatorios",      sub:"WhatsApp automático" },
    ]},
    { label:"Suscripción", rows:[
      { icon:"⭐", bg:"#F0EEF9", title:"Plan actual",         sub:"Cardigan Pro · $199/mes" },
      { icon:"📋", bg:"#EAF4F7", title:"Historial de pagos",  sub:"Ver facturas" },
    ]},
    { label:"Cuenta", rows:[
      { icon:"🔑", bg:"#FDF6E8", title:"Cambiar contraseña", sub:"" },
      { icon:"🚪", bg:"#FDF1F1", title:"Cerrar sesión",       sub:"", danger:true },
    ]},
  ];

  return (
    <div className="page">
      <div className="section" style={{ paddingTop:20 }}>
        <div className="card" style={{ padding:16 }}>
          <div className="flex items-center gap-3">
            <div style={{ width:52,height:52,background:"var(--teal)",borderRadius:"50%",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"var(--font-d)",fontSize:18,fontWeight:800,color:"white" }}>D</div>
            <div style={{ flex:1 }}>
              <div style={{ fontFamily:"var(--font-d)",fontSize:16,fontWeight:800,color:"var(--charcoal)" }}>Daniela Kim</div>
              <div style={{ fontSize:12.5,color:"var(--charcoal-xl)",marginTop:2 }}>dani@cardigan.app · Psicóloga</div>
            </div>
            <button className="btn btn-ghost" style={{ fontSize:13,height:34 }}>Editar</button>
          </div>
        </div>
      </div>
      {sections.map(s => (
        <div key={s.label}>
          <div className="settings-label">{s.label}</div>
          <div className="card" style={{ margin:"0 16px" }}>
            {s.rows.map((r,i) => (
              <div className="settings-row" key={i}>
                <div className="settings-row-icon" style={{ background:r.bg }}>{r.icon}</div>
                <div>
                  <div className="settings-row-title" style={{ color:r.danger?"var(--red)":undefined }}>{r.title}</div>
                  {r.sub && <div className="settings-row-sub">{r.sub}</div>}
                </div>
                <span className="settings-chevron">›</span>
              </div>
            ))}
          </div>
        </div>
      ))}
      <div style={{ height:20 }} />
    </div>
  );
}
