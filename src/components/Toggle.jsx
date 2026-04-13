export function Toggle({ on, onToggle, type }) {
  return (
    <button type={type || "button"} onClick={onToggle}
      style={{ width:44, height:26, minHeight:26, borderRadius:13, border:"none", cursor:"pointer", padding:3, background: on ? "var(--teal)" : "var(--charcoal-xl)", transition:"background 0.2s", position:"relative", flexShrink:0 }}>
      <div style={{ width:20, height:20, borderRadius:"50%", background:"white", boxShadow:"0 1px 3px rgba(0,0,0,0.2)", transform: on ? "translateX(18px)" : "translateX(0)", transition:"transform 0.2s" }} />
    </button>
  );
}
