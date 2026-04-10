import { useRef, useState, useCallback } from "react";
import { navItems } from "../data/seedData";
import { IconHome, IconCalendar, IconUsers, IconDollar, IconDocument, IconClipboard, IconSettings, IconStar, IconLogOut } from "./Icons";
import { LogoIcon } from "./LogoMark";
import { useT } from "../i18n/index";

const NAV_ICONS = {
  home: IconHome,
  calendar: IconCalendar,
  users: IconUsers,
  dollar: IconDollar,
  clipboard: IconClipboard,
  document: IconDocument,
  settings: IconSettings,
};

const PANEL_WIDTH = 300;
const OPEN_THRESHOLD = 100;
const CLOSE_THRESHOLD = 80;
const VELOCITY_THRESHOLD = 0.3;

export function Drawer({ screen, setScreen, onClose, user, signOut, open, swipeProgress }) {
  const { t } = useT();
  const principal = navItems.filter(n => n.section === "principal");
  const cuenta    = navItems.filter(n => n.section === "cuenta");
  const handleNav = (id) => { setScreen(id); onClose(); };

  const userName = user?.user_metadata?.full_name || user?.email?.split("@")[0] || "Usuario";
  const userEmail = user?.email || "";
  const userInitial = userName.charAt(0).toUpperCase();

  /* ── Close swipe: track leftward drag on the open panel ── */
  const dragRef = useRef(null);
  const [dragOffset, setDragOffset] = useState(0);
  const [dragging, setDragging] = useState(false);

  const onPanelTouchStart = useCallback((e) => {
    if (!open) return;
    dragRef.current = { x: e.touches[0].clientX, time: Date.now(), active: false };
  }, [open]);

  const onPanelTouchMove = useCallback((e) => {
    if (!dragRef.current) return;
    const dx = e.touches[0].clientX - dragRef.current.x;
    const dy = e.touches[0].clientY - (dragRef.current.y || e.touches[0].clientY);
    if (!dragRef.current.y) dragRef.current.y = e.touches[0].clientY;
    if (!dragRef.current.active) {
      if (dx < -8 && Math.abs(dx) > Math.abs(dy)) {
        dragRef.current.active = true;
        setDragging(true);
      } else if (Math.abs(dy) > 10 || dx > 10) {
        dragRef.current = null;
        return;
      } else return;
    }
    if (dragRef.current.active) {
      setDragOffset(Math.min(0, dx));
    }
  }, []);

  const onPanelTouchEnd = useCallback((e) => {
    if (!dragRef.current?.active) { dragRef.current = null; return; }
    const dx = e.changedTouches[0].clientX - dragRef.current.x;
    const elapsed = Date.now() - dragRef.current.time;
    const velocity = Math.abs(dx) / elapsed;
    dragRef.current = null;
    setDragging(false);

    // Close if dragged far enough or fast enough
    if (dx < -CLOSE_THRESHOLD || velocity > VELOCITY_THRESHOLD) {
      setDragOffset(-PANEL_WIDTH);
      setTimeout(() => { setDragOffset(0); onClose(); }, 280);
    } else {
      setDragOffset(0);
    }
  }, [onClose]);

  // Calculate panel position
  let translateX, overlayOpacity, transition, visible;

  if (dragging) {
    // Dragging to close — follow finger
    translateX = dragOffset;
    overlayOpacity = Math.max(0, 1 + dragOffset / PANEL_WIDTH);
    transition = "none";
    visible = true;
  } else if (open) {
    // Fully open or animating closed
    translateX = dragOffset; // 0 when static, -PANEL_WIDTH when animating close
    overlayOpacity = dragOffset === 0 ? 1 : 0;
    transition = `transform 0.28s cubic-bezier(0.32, 0.72, 0, 1)`;
    visible = true;
  } else if (swipeProgress > 0) {
    // Edge swipe opening — follow finger
    translateX = Math.min(swipeProgress, PANEL_WIDTH) - PANEL_WIDTH;
    overlayOpacity = Math.min(swipeProgress / PANEL_WIDTH, 1);
    transition = "none";
    visible = true;
  } else {
    // Fully closed
    translateX = -PANEL_WIDTH;
    overlayOpacity = 0;
    transition = `transform 0.28s cubic-bezier(0.32, 0.72, 0, 1)`;
    visible = false;
  }

  const renderItem = (item) => {
    const Icon = NAV_ICONS[item.iconId];
    return (
      <button key={item.id} className={`drawer-item ${screen===item.id?"active":""}`} onClick={() => handleNav(item.id)}>
        <div className="drawer-item-icon">{Icon && <Icon size={18} />}</div>
        <span className="drawer-item-label">{t(`nav.${item.id}`)}</span>
      </button>
    );
  };

  return (
    <>
      {/* Overlay */}
      <div className="drawer-overlay"
        onClick={onClose}
        style={{
          opacity: overlayOpacity,
          transition: dragging || swipeProgress > 0 ? "none" : "opacity 0.28s",
          pointerEvents: visible ? "auto" : "none",
          visibility: visible || open ? "visible" : "hidden",
          animation: "none",
        }} />

      {/* Panel */}
      <div className="drawer" style={{ pointerEvents: visible ? "auto" : "none" }}>
        <div className="drawer-panel"
          style={{ transform: `translateX(${translateX}px)`, transition, animation: "none" }}
          onTouchStart={onPanelTouchStart} onTouchMove={onPanelTouchMove} onTouchEnd={onPanelTouchEnd}>
          <div className="drawer-header">
            <div className="drawer-logo"><LogoIcon size={24} color="var(--teal-light)" /><span>cardigan</span></div>
            <div className="drawer-user">
              <div className="drawer-avatar">{userInitial}</div>
              <div>
                <div className="drawer-user-name">{userName}</div>
                <div className="drawer-user-sub">{userEmail}</div>
              </div>
            </div>
          </div>
          <nav className="drawer-nav">
            <div className="drawer-section-label">{t("nav.principal")}</div>
            {principal.map(renderItem)}
            <div className="drawer-section-label" style={{ marginTop:8 }}>{t("nav.account")}</div>
            {cuenta.map(renderItem)}
            <button className="drawer-item" onClick={() => { signOut(); onClose(); }}>
              <div className="drawer-item-icon"><IconLogOut size={18} /></div>
              <span className="drawer-item-label">{t("nav.signOut")}</span>
            </button>
          </nav>
          <div className="drawer-footer">
            <div className="drawer-plan">
              <div className="drawer-plan-icon"><IconStar size={16} /></div>
              <div>
                <div className="drawer-plan-label">{t("settings.planActive")}</div>
                <div className="drawer-plan-value">{t("settings.planValue")}</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
