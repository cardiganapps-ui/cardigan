import { navItems } from "../data/seedData";

export function Drawer({ screen, setScreen, onClose }) {
  const principal = navItems.filter(n => n.section === "principal");
  const cuenta    = navItems.filter(n => n.section === "cuenta");
  const handleNav = (id) => { setScreen(id); onClose(); };

  return (
    <div className="drawer-overlay" onClick={onClose}>
      <div className="drawer" onClick={e => e.stopPropagation()}>
        <div className="drawer-panel">
          <div className="drawer-header">
            <div className="drawer-logo">cardigan</div>
            <div className="drawer-user">
              <div className="drawer-avatar">D</div>
              <div>
                <div className="drawer-user-name">Daniela Kim</div>
                <div className="drawer-user-sub">dani@cardigan.app · Psicóloga</div>
              </div>
            </div>
          </div>
          <nav className="drawer-nav">
            <div className="drawer-section-label">Principal</div>
            {principal.map(item => (
              <button key={item.id} className={`drawer-item ${screen===item.id?"active":""}`} onClick={() => handleNav(item.id)}>
                <div className="drawer-item-icon">{item.icon}</div>
                <span className="drawer-item-label">{item.label}</span>
              </button>
            ))}
            <div className="drawer-section-label" style={{ marginTop:8 }}>Cuenta</div>
            {cuenta.map(item => (
              <button key={item.id} className={`drawer-item ${screen===item.id?"active":""}`} onClick={() => handleNav(item.id)}>
                <div className="drawer-item-icon">{item.icon}</div>
                <span className="drawer-item-label">{item.label}</span>
              </button>
            ))}
          </nav>
          <div className="drawer-footer">
            <div className="drawer-plan">
              <div className="drawer-plan-icon">⭐</div>
              <div>
                <div className="drawer-plan-label">Plan activo</div>
                <div className="drawer-plan-value">Cardigan Pro · $199/mes</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
