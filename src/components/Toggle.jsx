export function Toggle({ on, onToggle, type }) {
  return (
    <button type={type || "button"} onClick={onToggle}
      style={{ width:36, height:20, minHeight:20, borderRadius:10, border:"none", cursor:"pointer", padding:2, background: on ? "var(--teal)" : "var(--cream-deeper)", transition:"background 0.2s", position:"relative", flexShrink:0 }}>
      <div style={{ width:16, height:16, borderRadius:"50%", background:"white", boxShadow:"0 1px 3px rgba(0,0,0,0.2)", transform: on ? "translateX(16px)" : "translateX(0)", transition:"transform 0.2s" }} />
    </button>
  );
}
