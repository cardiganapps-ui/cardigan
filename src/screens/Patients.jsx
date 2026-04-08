import { useState } from "react";
import { clientColors, DAY_ORDER } from "../data/seedData";
import { IconSearch, IconX, IconUsers } from "../components/Icons";
import { todayISO } from "../data/api";
const Toggle = ({ on, onToggle }) => (
  <button type="button" onClick={onToggle}
    style={{ width:36, height:20, borderRadius:10, border:"none", cursor:"pointer", padding:2, background: on ? "var(--teal)" : "var(--cream-deeper)", transition:"background 0.2s", position:"relative", flexShrink:0 }}>
    <div style={{ width:16, height:16, borderRadius:"50%", background:"white", boxShadow:"0 1px 3px rgba(0,0,0,0.2)", transform: on ? "translateX(16px)" : "translateX(0)", transition:"transform 0.2s" }} />
  </button>
);

export function Patients({ patients, onRecordPayment, updatePatient, deletePatient, generateRecurringSessions, mutating }) {
  const [search, setSearch]     = useState("");
  const [filter, setFilter]     = useState("all");
  const [sort, setSort]         = useState("name");
  const [selected, setSelected] = useState(null);
  const [editing, setEditing]   = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Edit form state
  const [editName, setEditName]       = useState("");
  const [editIsMinor, setEditIsMinor] = useState(false);
  const [editParent, setEditParent]   = useState("");
  const [editRate, setEditRate]       = useState("");
  const [editStatus, setEditStatus]   = useState("");
  const [editSchedules, setEditSchedules] = useState([{ day: "Lunes", time: "16:00" }]);
  const [genStartDate, setGenStartDate]   = useState(todayISO());
  const [genHasEndDate, setGenHasEndDate] = useState(false);
  const [genEndDate, setGenEndDate]       = useState("");

  const openDetail = (p) => {
    setSelected(p);
    setEditing(false);
    setConfirmDelete(false);
  };

  const startEdit = () => {
    setEditName(selected.name);
    setEditIsMinor(!!selected.parent);
    setEditParent(selected.parent || "");
    setEditRate(String(selected.rate));
    setEditStatus(selected.status);
    setEditSchedules([{ day: selected.day, time: selected.time }]);
    setGenStartDate(todayISO());
    setGenHasEndDate(false);
    setGenEndDate("");
    setEditing(true);
  };

  const updateEditSched = (i, f, v) => setEditSchedules(prev => prev.map((s, idx) => idx === i ? { ...s, [f]: v } : s));

  const saveEdit = async () => {
    const primary = editSchedules[0] || { day: "Lunes", time: "16:00" };
    const ok = await updatePatient(selected.id, {
      name: editName.trim(),
      parent: editIsMinor ? editParent.trim() : "",
      rate: Number(editRate) || 0,
      day: primary.day,
      time: primary.time,
      status: editStatus,
    });
    if (ok) {
      setSelected(null);
      setEditing(false);
    }
  };

  const handleDelete = async () => {
    const ok = await deletePatient(selected.id);
    if (ok) {
      setSelected(null);
      setConfirmDelete(false);
    }
  };

  const filters = [
    {k:"all",l:"Todos"},{k:"active",l:"Activos"},{k:"ended",l:"Finalizados"},
    {k:"owes",l:"Con saldo"},{k:"paid",l:"Al corriente"},
  ];
  const sorts = [
    {k:"name",l:"Nombre"},{k:"day",l:"Día de sesión"},
    {k:"sessions",l:"Sesiones"},{k:"rate",l:"Tarifa"},
  ];

  const applyFilter = (p) => {
    if (filter==="active") return p.status==="active";
    if (filter==="ended")  return p.status==="ended";
    if (filter==="owes")   return p.amountDue>0;
    if (filter==="paid")   return p.amountDue<=0;
    return true;
  };
  const applySort = (a,b) => {
    if (sort==="name")     return a.name.localeCompare(b.name);
    if (sort==="day")      return DAY_ORDER.indexOf(a.day)-DAY_ORDER.indexOf(b.day);
    if (sort==="sessions") return b.sessions-a.sessions;
    if (sort==="rate")     return b.rate-a.rate;
    return 0;
  };
  const filtered = patients.filter(p => p.name.toLowerCase().includes(search.toLowerCase()) && applyFilter(p)).sort(applySort);

  // Empty state
  if (patients.length === 0) {
    return (
      <div className="page" style={{ display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", textAlign:"center", padding:"40px 24px" }}>
        <div style={{ width:56, height:56, background:"var(--teal-pale)", borderRadius:"50%", display:"flex", alignItems:"center", justifyContent:"center", marginBottom:16, color:"var(--teal)" }}>
          <IconUsers size={26} />
        </div>
        <div style={{ fontFamily:"var(--font-d)", fontSize:17, fontWeight:800, color:"var(--charcoal)", marginBottom:6 }}>Sin pacientes</div>
        <div style={{ fontSize:13, color:"var(--charcoal-xl)", lineHeight:1.5 }}>Usa el botón + para agregar tu primer paciente.</div>
      </div>
    );
  }

  return (
    <div className="page">
      <div style={{ padding:"16px 16px 10px" }}>
        <div className="search-bar">
          <span style={{ color:"var(--charcoal-xl)" }}><IconSearch size={16} /></span>
          <input placeholder="Buscar paciente…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
      </div>
      <div className="filter-chips">
        {filters.map(f => <button key={f.k} className={`chip ${filter===f.k?"active":""}`} onClick={() => setFilter(f.k)}>{f.l}</button>)}
      </div>
      <div className="sort-row">
        <span style={{ fontSize:12, color:"var(--charcoal-xl)", fontWeight:600 }}>{filtered.length} paciente{filtered.length!==1?"s":""}</span>
        <div style={{ display:"flex", alignItems:"center", gap:6 }}>
          <span className="sort-label">Ordenar:</span>
          <select className="sort-select" value={sort} onChange={e => setSort(e.target.value)}>
            {sorts.map(s => <option key={s.k} value={s.k}>{s.l}</option>)}
          </select>
        </div>
      </div>
      <div style={{ padding:"0 16px 12px" }}>
        <div className="card">
          {filtered.length === 0
            ? <div style={{ padding:"28px 16px", textAlign:"center", color:"var(--charcoal-xl)", fontSize:13 }}>Sin resultados</div>
            : filtered.map((p,i) => (
              <div className="row-item" key={p.id} onClick={() => openDetail(p)}>
                <div className="row-avatar" style={{ background: clientColors[i%clientColors.length] }}>{p.initials}</div>
                <div className="row-content">
                  <div className="row-title">{p.name}</div>
                  <div className="row-sub">{p.day} · {p.time}</div>
                </div>
                <div style={{ display:"flex", flexDirection:"column", alignItems:"flex-end", gap:5, flexShrink:0 }}>
                  <span className={`badge ${p.status==="active"?"badge-teal":"badge-gray"}`}>{p.status==="active"?"Activo":"Finalizado"}</span>
                  <span style={{ fontSize:11, color:"var(--charcoal-xl)", fontWeight:600 }}>{p.sessions} ses. · ${p.rate}/ses</span>
                </div>
                <span className="row-chevron">›</span>
              </div>
            ))
          }
        </div>
      </div>

      {selected && (
        <div className="sheet-overlay" onClick={() => { setSelected(null); setEditing(false); setConfirmDelete(false); }}>
          <div className="sheet-panel" onClick={e => e.stopPropagation()}>
            <div className="sheet-handle" />
            <div className="sheet-header">
              <span className="sheet-title">{editing ? "Editar paciente" : selected.name}</span>
              <button className="sheet-close" onClick={() => { setSelected(null); setEditing(false); setConfirmDelete(false); }}><IconX size={14} /></button>
            </div>
            <div style={{ padding:"0 20px 24px" }}>
              {editing ? (
                /* ── EDIT MODE ── */
                <div>
                  <div className="input-group">
                    <label className="input-label">Nombre</label>
                    <input className="input" value={editName} onChange={e => setEditName(e.target.value)} />
                  </div>
                  <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom: editIsMinor ? 6 : 14 }}>
                    <span style={{ fontSize:12, fontWeight:600, color:"var(--charcoal-md)" }}>Es menor de edad</span>
                    <Toggle on={editIsMinor} onToggle={() => setEditIsMinor(v => !v)} />
                  </div>
                  {editIsMinor && (
                    <div className="input-group">
                      <label className="input-label">Tutor / contacto</label>
                      <input className="input" value={editParent} onChange={e => setEditParent(e.target.value)} />
                    </div>
                  )}
                  <div className="input-group">
                    <label className="input-label">Tarifa</label>
                    <input className="input" type="number" value={editRate} onChange={e => setEditRate(e.target.value)} placeholder="Ej: 700" />
                  </div>
                  <div className="input-group">
                    <label className="input-label">Estado</label>
                    <select className="input" value={editStatus} onChange={e => setEditStatus(e.target.value)}>
                      <option value="active">Activo</option>
                      <option value="ended">Finalizado</option>
                    </select>
                  </div>

                  <div style={{ borderTop:"1px solid var(--border-lt)", marginTop:4, paddingTop:14, marginBottom:14 }}>
                    <div style={{ fontSize:13, fontWeight:700, color:"var(--charcoal)", marginBottom:10 }}>Horarios de sesión</div>
                    {editSchedules.map((s, i) => (
                      <div key={i} style={{ display:"grid", gridTemplateColumns: editSchedules.length > 1 ? "1fr 1fr 28px" : "1fr 1fr", gap:8, marginBottom:8, alignItems:"end" }}>
                        <div className="input-group" style={{ marginBottom:0 }}>
                          {i === 0 && <label className="input-label">Día</label>}
                          <select className="input" value={s.day} onChange={e => updateEditSched(i, "day", e.target.value)}>
                            {DAY_ORDER.map(d => <option key={d} value={d}>{d}</option>)}
                          </select>
                        </div>
                        <div className="input-group" style={{ marginBottom:0 }}>
                          {i === 0 && <label className="input-label">Hora</label>}
                          <input className="input" type="time" value={s.time} onChange={e => updateEditSched(i, "time", e.target.value)} />
                        </div>
                        {editSchedules.length > 1 && (
                          <button type="button" onClick={() => setEditSchedules(prev => prev.filter((_, idx) => idx !== i))}
                            style={{ width:28, height:28, borderRadius:"50%", border:"none", background:"var(--red-bg)", color:"var(--red)", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
                            <IconX size={12} />
                          </button>
                        )}
                      </div>
                    ))}
                    <button type="button" onClick={() => setEditSchedules(prev => [...prev, { day: "Lunes", time: "16:00" }])}
                      style={{ fontSize:12, fontWeight:600, color:"var(--teal-dark)", background:"none", border:"none", cursor:"pointer", padding:"4px 0 12px", fontFamily:"var(--font)" }}>
                      + Agregar otro horario
                    </button>

                    <div style={{ background:"var(--cream)", borderRadius:"var(--radius)", padding:"12px 14px", marginBottom:12 }}>
                      <div className="input-group" style={{ marginBottom:10 }}>
                        <label className="input-label">Generar desde</label>
                        <input className="input" type="date" value={genStartDate} onChange={e => setGenStartDate(e.target.value)} />
                      </div>
                      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom: genHasEndDate ? 8 : 0 }}>
                        <span style={{ fontSize:12, fontWeight:600, color:"var(--charcoal-md)" }}>Fecha de fin</span>
                        <Toggle on={genHasEndDate} onToggle={() => setGenHasEndDate(v => !v)} />
                      </div>
                      {genHasEndDate ? (
                        <div className="input-group" style={{ marginBottom:0 }}>
                          <input className="input" type="date" value={genEndDate} onChange={e => setGenEndDate(e.target.value)} />
                        </div>
                      ) : (
                        <div style={{ fontSize:11, color:"var(--charcoal-xl)", marginTop:4 }}>Permanente — se renuevan automáticamente</div>
                      )}
                    </div>
                    <button type="button" className="btn" style={{ background:"var(--teal-pale)", color:"var(--teal-dark)", boxShadow:"none", whiteSpace:"nowrap", fontSize:12, fontWeight:700, width:"100%" }}
                      disabled={mutating}
                      onClick={async () => {
                        await generateRecurringSessions(selected.id, editSchedules, genStartDate, genHasEndDate ? genEndDate : null);
                      }}
                    >
                      {mutating ? "Generando..." : "Generar citas recurrentes"}
                    </button>
                  </div>

                  <button className="btn btn-primary" style={{ marginBottom:10 }} onClick={saveEdit} disabled={mutating}>
                    {mutating ? "Guardando..." : "Guardar cambios"}
                  </button>
                  <button className="btn btn-secondary w-full" onClick={() => setEditing(false)}>Cancelar</button>
                </div>
              ) : confirmDelete ? (
                /* ── DELETE CONFIRMATION ── */
                <div style={{ textAlign:"center" }}>
                  <div style={{ fontFamily:"var(--font-d)", fontSize:16, fontWeight:800, color:"var(--charcoal)", marginBottom:8 }}>¿Eliminar a {selected.name}?</div>
                  <div style={{ fontSize:13, color:"var(--charcoal-xl)", lineHeight:1.5, marginBottom:20 }}>Se eliminarán también todas sus sesiones. Los pagos se conservarán.</div>
                  <button className="btn btn-danger" style={{ marginBottom:10 }} onClick={handleDelete} disabled={mutating}>
                    {mutating ? "Eliminando..." : "Sí, eliminar paciente"}
                  </button>
                  <button className="btn btn-secondary w-full" onClick={() => setConfirmDelete(false)}>Cancelar</button>
                </div>
              ) : (
                /* ── VIEW MODE ── */
                <>
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:8, marginBottom:20 }}>
                    {[
                      { label:"Vendido", value:`$${selected.billed.toLocaleString()}` },
                      { label:"Cobrado", value:`$${selected.paid.toLocaleString()}`, color:"var(--green)" },
                      { label:"Saldo",   value:`$${selected.amountDue.toLocaleString()}`, color: selected.amountDue>0?"var(--red)":"var(--charcoal-xl)" },
                    ].map((s,i) => (
                      <div key={i} style={{ background:"var(--cream)", borderRadius:"var(--radius)", padding:"12px 10px", textAlign:"center" }}>
                        <div style={{ fontSize:10, fontWeight:700, textTransform:"uppercase", letterSpacing:"0.07em", color:"var(--charcoal-xl)", marginBottom:4 }}>{s.label}</div>
                        <div style={{ fontFamily:"var(--font-d)", fontSize:16, fontWeight:800, color:s.color||"var(--charcoal)" }}>{s.value}</div>
                      </div>
                    ))}
                  </div>
                  {[
                    { label:"Tutor",            value: selected.parent || "—" },
                    { label:"Sesión regular",   value:`${selected.day} a las ${selected.time}` },
                    { label:"Tarifa",           value:`$${selected.rate} por sesión` },
                    { label:"Sesiones totales", value:`${selected.sessions} sesiones` },
                    { label:"Estado",           value: selected.status==="active"?"Activo":"Finalizado" },
                  ].map((row,i) => (
                    <div key={i} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"12px 0", borderBottom:"1px solid var(--border-lt)" }}>
                      <span style={{ fontSize:13, color:"var(--charcoal-xl)" }}>{row.label}</span>
                      <span style={{ fontSize:13, fontWeight:600, color:"var(--charcoal)" }}>{row.value}</span>
                    </div>
                  ))}
                  <div style={{ marginTop:20, display:"flex", flexDirection:"column", gap:10 }}>
                    <button className="btn btn-primary" style={{ height:48 }} onClick={() => onRecordPayment(selected)} disabled={mutating}>
                      {mutating ? "Guardando..." : "Registrar pago"}
                    </button>
                    <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
                      <button className="btn btn-secondary" style={{ height:44, fontSize:13 }} onClick={startEdit}>Editar</button>
                      <button className="btn" style={{ height:44, fontSize:13, background:"var(--red-bg)", color:"var(--red)", boxShadow:"none" }} onClick={() => setConfirmDelete(true)}>Eliminar</button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
