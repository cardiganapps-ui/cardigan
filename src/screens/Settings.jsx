import { IconUser, IconCurrency, IconBell, IconStar, IconClipboard, IconKey, IconLogOut, IconChevron } from "../components/Icons";

export function Settings({ user, signOut }) {
  const userName = user?.user_metadata?.full_name || user?.email?.split("@")[0] || "Usuario";
  const userEmail = user?.email || "";
  const userInitial = userName.charAt(0).toUpperCase();

  const sections = [
    { label:"Mi práctica", rows:[
      { Icon: IconUser,      title:"Perfil profesional", sub: userName },
      { Icon: IconCurrency,  title:"Moneda y precios",   sub:"MXN — Peso Mexicano" },
      { Icon: IconBell,      title:"Recordatorios",      sub:"WhatsApp automático" },
    ]},
    { label:"Suscripción", rows:[
      { Icon: IconStar,      title:"Plan actual",         sub:"Cardigan Pro" },
      { Icon: IconClipboard, title:"Historial de pagos",  sub:"Ver facturas" },
    ]},
    { label:"Cuenta", rows:[
      { Icon: IconKey,    title:"Cambiar contraseña", sub:"" },
      { Icon: IconLogOut, title:"Cerrar sesión", sub:"", danger:true, action: signOut },
    ]},
  ];

  return (
    <div className="page">
      <div className="section" style={{ paddingTop:20 }}>
        <div className="card" style={{ padding:16 }}>
          <div className="flex items-center gap-3">
            <div style={{ width:52,height:52,background:"var(--teal)",borderRadius:"50%",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"var(--font-d)",fontSize:18,fontWeight:800,color:"white" }}>{userInitial}</div>
            <div style={{ flex:1 }}>
              <div style={{ fontFamily:"var(--font-d)",fontSize:16,fontWeight:800,color:"var(--charcoal)" }}>{userName}</div>
              <div style={{ fontSize:12.5,color:"var(--charcoal-xl)",marginTop:2 }}>{userEmail}</div>
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
              <div className="settings-row" key={i} onClick={r.action || undefined} style={r.action ? { cursor:"pointer" } : undefined}>
                <div className="settings-row-icon" style={{ color: r.danger ? "var(--red)" : "var(--teal-dark)" }}>
                  <r.Icon size={18} />
                </div>
                <div style={{ flex:1 }}>
                  <div className="settings-row-title" style={{ color:r.danger?"var(--red)":undefined }}>{r.title}</div>
                  {r.sub && <div className="settings-row-sub">{r.sub}</div>}
                </div>
                <IconChevron />
              </div>
            ))}
          </div>
        </div>
      ))}
      <div style={{ height:20 }} />
    </div>
  );
}
