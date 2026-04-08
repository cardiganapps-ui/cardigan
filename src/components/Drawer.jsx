import { navItems } from "../data/seedData";
import { IconHome, IconCalendar, IconUsers, IconDollar, IconSettings, IconStar, IconLogOut } from "./Icons";

const NAV_ICONS = {
  home: IconHome,
  calendar: IconCalendar,
  users: IconUsers,
  dollar: IconDollar,
  settings: IconSettings,
};

const PANEL_WIDTH = 300;

export function Drawer({ screen, setScreen, onClose, user, signOut, open, swipeX }) {
  const principal = navItems.filter(n => n.section === "principal");
  const cuenta    = navItems.filter(n => n.section === "cuenta");
  const handleNav = (id) => { setScreen(id); onClose(); };

  const userName = user?.user_metadata?.full_name || user?.email?.split("@")[0] || "Usuario";
  const userEmail = user?.email || "";
  const userInitial = userName.charAt(0).toUpperCase();

  const isSwiping = swipeX !== null;
  const active = open || isSwiping;

  let panelStyle, overlayStyle;
  const ease = "cubic-bezier(0.32, 0.72, 0, 1)";

  if (open) {
    panelStyle = { transform: "translateX(0)", transition: `transform 0.25s ${ease}` };
    overlayStyle = { opacity: 1, transition: "opacity 0.25s", pointerEvents: "auto" };
  } else if (isSwiping) {
    const clamped = Math.max(0, Math.min(PANEL_WIDTH, swipeX));
    const progress = clamped / PANEL_WIDTH;
    panelStyle = { transform: `translateX(${clamped - PANEL_WIDTH}px)`, transition: "none" };
    overlayStyle = { opacity: progress, transition: "none", pointerEvents: "auto" };
  } else {
    panelStyle = { transform: "translateX(-100%)", transition: `transform 0.25s ${ease}` };
    overlayStyle = { opacity: 0, transition: "opacity 0.25s", pointerEvents: "none" };
  }

  const renderItem = (item) => {
    const Icon = NAV_ICONS[item.iconId];
    return (
      <button key={item.id} className={`drawer-item ${screen===item.id?"active":""}`} onClick={() => handleNav(item.id)}>
        <div className="drawer-item-icon">{Icon && <Icon size={18} />}</div>
        <span className="drawer-item-label">{item.label}</span>
      </button>
    );
  };

  return (
    <>
      <div className="drawer-overlay" onClick={onClose}
        style={{ ...overlayStyle, animation: "none", visibility: (!active && !open) ? "hidden" : "visible" }} />
      <div className="drawer" onClick={e => e.stopPropagation()}>
        <div className="drawer-panel" style={{ ...panelStyle, animation: "none" }}>
          <div className="drawer-header">
            <div className="drawer-logo">cardigan</div>
            <div className="drawer-user">
              <div className="drawer-avatar">{userInitial}</div>
              <div>
                <div className="drawer-user-name">{userName}</div>
                <div className="drawer-user-sub">{userEmail}</div>
              </div>
            </div>
          </div>
          <nav className="drawer-nav">
            <div className="drawer-section-label">Principal</div>
            {principal.map(renderItem)}
            <div className="drawer-section-label" style={{ marginTop:8 }}>Cuenta</div>
            {cuenta.map(renderItem)}
            <button className="drawer-item" onClick={() => { signOut(); onClose(); }}>
              <div className="drawer-item-icon"><IconLogOut size={18} /></div>
              <span className="drawer-item-label">Cerrar sesión</span>
            </button>
          </nav>
          <div className="drawer-footer">
            <div className="drawer-plan">
              <div className="drawer-plan-icon"><IconStar size={16} /></div>
              <div>
                <div className="drawer-plan-label">Plan activo</div>
                <div className="drawer-plan-value">Cardigan Pro</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
