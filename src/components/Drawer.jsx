import { useRef, useState, useCallback, useEffect } from "react";
import { navItems } from "../data/seedData";
import { IconHome, IconCalendar, IconUsers, IconDollar, IconDocument, IconClipboard, IconSettings, IconStar, IconLogOut, IconBug } from "./Icons";
import { LogoIcon } from "./LogoMark";
import { AvatarContent } from "./Avatar";
import { useAvatarUrl } from "../hooks/useAvatarUrl";
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

export function Drawer({ screen, setScreen, onClose, user, signOut, open, swipeProgress, onReportBug }) {
  const { t } = useT();
  const principal = navItems.filter(n => n.section === "principal");
  const cuenta    = navItems.filter(n => n.section === "cuenta");
  const handleNav = (id) => { setScreen(id); onClose(); };

  const userName = user?.user_metadata?.full_name || user?.email?.split("@")[0] || "Usuario";
  const userEmail = user?.email || "";
  const userInitial = userName.charAt(0).toUpperCase();
  const { imageUrl: avatarImageUrl } = useAvatarUrl(user?.user_metadata?.avatar);

  /* ── Close swipe: track leftward drag on the open panel ── */
  const dragRef = useRef(null);
  const [dragOffset, setDragOffset] = useState(0);
  const [dragging, setDragging] = useState(false);

  // Reset any stale drag state whenever the drawer transitions closed →
  // open or is closed programmatically (e.g. nav change mid-gesture).
  // Adjust-during-render pattern for setState; ref reset is in an
  // effect (ref mutation during render is unsafe under concurrent
  // rendering — an aborted render could leave the ref desynced).
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    setDragging(false);
    setDragOffset(0);
  }
  useEffect(() => { dragRef.current = null; }, [open]);

  const onPanelTouchStart = useCallback((e) => {
    if (!open) return;
    const t0 = e.touches[0];
    dragRef.current = { x: t0.clientX, y: t0.clientY, time: Date.now(), active: false };
  }, [open]);

  const onPanelTouchMove = useCallback((e) => {
    if (!dragRef.current) return;
    const dx = e.touches[0].clientX - dragRef.current.x;
    const dy = e.touches[0].clientY - dragRef.current.y;
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

    // Close if dragged far enough left or fast enough leftward
    if (dx < -CLOSE_THRESHOLD || (dx < -10 && velocity > VELOCITY_THRESHOLD)) {
      setDragOffset(-PANEL_WIDTH);
      setTimeout(() => { setDragOffset(0); onClose(); }, 280);
    } else {
      setDragOffset(0);
    }
  }, [onClose]);

  const onPanelTouchCancel = useCallback(() => {
    // iOS can cancel gestures (incoming call, multi-touch, etc). Clear all
    // drag bookkeeping so the panel doesn't get stuck off-screen.
    dragRef.current = null;
    setDragging(false);
    setDragOffset(0);
  }, []);

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
    transition = `transform 0.6s cubic-bezier(0.34, 1.56, 0.64, 1)`;
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
    transition = `transform 0.6s cubic-bezier(0.34, 1.56, 0.64, 1)`;
    visible = false;
  }

  const renderItem = (item) => {
    const Icon = NAV_ICONS[item.iconId];
    return (
      <button key={item.id} className={`drawer-item ${screen===item.id?"active":""}`} data-tour={`nav-${item.id}`} onClick={() => handleNav(item.id)}>
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
          transition: dragging || swipeProgress > 0 ? "none" : "opacity 0.7s",
          pointerEvents: overlayOpacity > 0 ? "auto" : "none",
        }} />

      {/* Panel */}
      <div className="drawer" style={{ pointerEvents: visible ? "auto" : "none" }} onClick={open ? onClose : undefined}
        onTouchStart={onPanelTouchStart} onTouchMove={onPanelTouchMove}
        onTouchEnd={onPanelTouchEnd} onTouchCancel={onPanelTouchCancel}>
        <div className={`drawer-panel${visible ? " drawer-panel--visible" : ""}`} onClick={e => e.stopPropagation()}
          style={{ transform: `translateX(${translateX}px)`, transition }}>
          <div className="drawer-header">
            <div className="drawer-logo"><LogoIcon size={24} color="var(--teal-light)" /><span>cardigan</span></div>
            <div className="drawer-user" role="button" tabIndex={0}
              onClick={() => handleNav("settings")}
              style={{ cursor: "pointer", WebkitTapHighlightColor: "transparent" }}>
              <div className="drawer-avatar">
                <AvatarContent
                  initials={userInitial}
                  imageUrl={avatarImageUrl}
                />
              </div>
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
            {onReportBug && (
              <button className="drawer-item" onClick={onReportBug}>
                <div className="drawer-item-icon"><IconBug size={18} /></div>
                <span className="drawer-item-label">{t("bugReport.title")}</span>
              </button>
            )}
            <button className="drawer-item" onClick={() => { if (window.confirm(t("nav.signOutConfirm"))) { signOut(); onClose(); } }}>
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
