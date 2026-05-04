import { useRef, useState, useCallback, useEffect } from "react";
import { navItems } from "../data/seedData";
import { IconHome, IconCalendar, IconUsers, IconDollar, IconDocument, IconClipboard, IconSettings, IconStar, IconLogOut, IconBug } from "./Icons";
import { LogoIcon } from "./LogoMark";
import { AvatarContent } from "./Avatar";
import { ConfirmDialog } from "./ConfirmDialog";
import { useAvatarUrl } from "../hooks/useAvatarUrl";
import { useT } from "../i18n/index";
import { useCardigan } from "../context/CardiganContext";

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
  const { subscription } = useCardigan();
  const principal = navItems.filter(n => n.section === "principal");
  const cuenta    = navItems.filter(n => n.section === "cuenta");
  const handleNav = (id) => { setScreen(id); onClose(); };
  // Tapping the plan card jumps to Settings → Suscripción sheet. The
  // sheet is owned by Settings.jsx, so we navigate to the screen and
  // dispatch a window event the screen listens for. Same pattern would
  // work for any future "open this Settings sheet from anywhere" need.
  const handlePlanTap = () => {
    setScreen("settings");
    onClose();
    // Defer one frame so Settings is mounted before the listener fires.
    requestAnimationFrame(() => {
      window.dispatchEvent(new CustomEvent("cardigan-open-settings-sheet", {
        detail: { sheet: "plan" },
      }));
    });
  };
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  // Reset the inline confirm whenever the drawer transitions closed
  // (adjust-during-render — same pattern as prevOpen below).
  const [prevOpenForConfirm, setPrevOpenForConfirm] = useState(open);
  if (open !== prevOpenForConfirm) {
    setPrevOpenForConfirm(open);
    if (!open) setConfirmSignOut(false);
  }

  const userName = user?.user_metadata?.full_name || user?.email?.split("@")[0] || "Usuario";
  const userEmail = user?.email || "";
  const userInitial = userName.charAt(0).toUpperCase();
  const { imageUrl: avatarImageUrl } = useAvatarUrl(user?.user_metadata?.avatar);

  /* ── Close swipe: track leftward drag on the open panel ── */
  const dragRef = useRef(null);
  const [dragOffset, setDragOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  // Pending swipe-to-close animation timer. Tracked so we can cancel
  // it if the drawer is re-opened (or unmounted) before the timer
  // fires. Without this guard, a fast close-then-reopen sequence
  // hits the timer's onClose() ~280ms later and silently closes the
  // drawer the user just opened.
  const closeTimerRef = useRef(null);
  const cancelCloseTimer = useCallback(() => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  // Reset any stale drag state whenever the drawer transitions closed →
  // open or is closed programmatically (e.g. nav change mid-gesture).
  // Adjust-during-render pattern for setState; ref resets are in
  // effects (ref mutation during render is unsafe under concurrent
  // rendering — an aborted render could leave refs desynced).
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    setDragging(false);
    setDragOffset(0);
  }
  useEffect(() => {
    dragRef.current = null;
    // Cancel any swipe-close timer left over from the previous lifecycle
    // — a re-open before t+280 must not still trigger the queued close.
    cancelCloseTimer();
  }, [open, cancelCloseTimer]);
  // Belt-and-suspenders: also cancel on unmount so a queued timer
  // can't fire against a detached component.
  useEffect(() => () => cancelCloseTimer(), [cancelCloseTimer]);

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
      // Cancel any prior close timer (rapid swipe-then-swipe should
      // not stack two timers either) before queueing the close.
      cancelCloseTimer();
      closeTimerRef.current = setTimeout(() => {
        closeTimerRef.current = null;
        setDragOffset(0);
        onClose();
      }, 280);
    } else {
      setDragOffset(0);
    }
  }, [onClose, cancelCloseTimer]);

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
      {/* Tap-outside closes whenever the drawer is visible — not just when
          `open` is true. If an edge-swipe gesture is interrupted (iOS drops
          touchend on multi-touch / system gesture), swipeProgress can stick
          > 0 with open=false; the drawer renders fully but every close
          path was previously gated on `open` and stayed dead. Gating on
          `visible` + having onClose reset both state values (App.jsx) lets
          the user always tap the right strip to escape. */}
      <div className="drawer" style={{ pointerEvents: visible ? "auto" : "none" }} onClick={visible ? onClose : undefined}
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
            <button className="drawer-item" onClick={() => setConfirmSignOut(true)}>
              <div className="drawer-item-icon"><IconLogOut size={18} /></div>
              <span className="drawer-item-label">{t("nav.signOut")}</span>
            </button>
            <ConfirmDialog
              open={confirmSignOut}
              title={t("nav.signOut")}
              body={t("nav.signOutConfirm")}
              confirmLabel={t("nav.signOut")}
              destructive
              onConfirm={() => { setConfirmSignOut(false); signOut(); onClose(); }}
              onCancel={() => setConfirmSignOut(false)}
            />
          </nav>
          <div className="drawer-footer">
            {(() => {
              // Plan card variants: comp / active / trial / expired /
              // loading. Copy + accent shift accordingly so the chip
              // doubles as a status indicator before being tapped.
              const s = subscription || {};
              const compGranted = s.compGranted;
              const subscribedActive = s.subscribedActive;
              const trial = s.accessState === "trial";
              const expired = s.accessState === "expired";
              const days = s.daysLeftInTrial;
              const label = compGranted
                ? t("subscription.statusCompTitle")
                : subscribedActive
                  ? t("settings.planActive")
                  : trial && typeof days === "number"
                    ? t("subscription.statusTrialTitle")
                    : expired
                      ? t("subscription.statusExpiredTitle")
                      : t("settings.planActive");
              const value = compGranted
                ? t("subscription.statusComp")
                : subscribedActive
                  ? t("settings.planValue")
                  : trial && typeof days === "number"
                    ? (days <= 1
                        ? t("subscription.statusTrialEndsToday")
                        : t("subscription.statusTrialDaysLeft", { n: days }))
                    : expired
                      ? t("subscription.subscribeShort")
                      : t("settings.planValue");
              return (
                <button
                  type="button"
                  className="drawer-plan"
                  onClick={handlePlanTap}
                  data-state={expired ? "expired" : trial ? "trial" : "active"}
                  aria-label={`${label}: ${value}`}
                >
                  <div className="drawer-plan-icon"><IconStar size={16} /></div>
                  <div style={{ flex: 1, textAlign: "left" }}>
                    <div className="drawer-plan-label">{label}</div>
                    <div className="drawer-plan-value">{value}</div>
                  </div>
                </button>
              );
            })()}
          </div>
        </div>
      </div>
    </>
  );
}
