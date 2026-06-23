import { isNative } from "../../lib/platform";
import { IconSearch, IconBell, IconRefresh } from "../Icons";
import { LogoIcon } from "../LogoMark";
import TopbarActions from "../TopbarActions";
import Tooltip from "../Tooltip";
import { HelpTip } from "../HelpTip";
import { AvatarContent } from "../Avatar";

/* ── AppTopbar ────────────────────────────────────────────────────────
   The fixed top bar: hamburger, mobile search entry, brand, per-screen
   H1, and the right-side cluster (TopbarActions, inbox bell with unread
   dot, refresh, admin chip, contextual help, avatar → settings).

   PRESENTATIONAL extraction from AppShell — every signal it branches on
   (drawerOpen / readOnly / screen / admin / inboxUnread) and every
   handler (navigate / refresh / open-palette / open-inbox / drawer
   prefetch) threads in as props, so the JSX moved verbatim. */

export interface AppTopbarProps {
  drawerOpen: boolean;
  setDrawerOpen: (fn: (o: boolean) => boolean) => void;
  prefetchDrawer: () => void;
  readOnly?: boolean;
  setPaletteOpen: (v: boolean) => void;
  navigate: (id: string) => void;
  screen: string;
  setInboxOpen: (v: boolean) => void;
  inboxUnread: number;
  refresh: () => void;
  admin?: boolean;
  userInitial: string;
  avatarImageUrl: string | null;
  t: (key: string) => string;
}

export function AppTopbar({
  drawerOpen, setDrawerOpen, prefetchDrawer,
  readOnly, setPaletteOpen, navigate, screen,
  setInboxOpen, inboxUnread, refresh, admin,
  userInitial, avatarImageUrl, t,
}: AppTopbarProps) {
  return (
    <div className="topbar">
      <button
        className={`hamburger ${drawerOpen?"open":""}`}
        onClick={() => setDrawerOpen(o=>!o)}
        onMouseEnter={prefetchDrawer}
        onFocus={prefetchDrawer}
        aria-label={t("nav.menu")}
      >
        <div className="hamburger-line" />
        <div className="hamburger-line" />
        <div className="hamburger-line" />
      </button>
      {/* Mobile-only entry to the command palette / patient
          search. Cmd-K is keyboard-gated and TopbarActions is
          hidden below 768px, so without this iPhone users had
          no way to fuzzy-jump to a patient in a 30+ list. Lives
          on the LEFT next to the hamburger — the right side
          already carries the admin chip, help, and avatar; an
          extra circle there made the cluster feel cramped. */}
      {!readOnly && (
        <button
          type="button"
          className="topbar-search-mobile"
          onClick={() => setPaletteOpen(true)}
          aria-label={t("cmdp.open") || "Buscar"}
        >
          <IconSearch size={18} />
        </button>
      )}
      <button type="button" className="topbar-brand" onClick={() => navigate("home")} aria-label={t("nav.home")} style={{ cursor:"pointer", background:"none", border:"none", padding:0 }}><LogoIcon size={20} color="currentColor" /><span>cardigan</span></button>
      {/* Per-screen H1 — only visible on desktop (topbar-screen-name
          is `display: none` below 768px), but always announced to
          screen readers via aria-live=polite so an AT user knows
          what page they just navigated to. Without this the topbar
          had zero heading semantics and AT users had to infer the
          current screen from URL hash or active nav item. */}
      <h1 className="topbar-screen-name" aria-live="polite">{t(`nav.${screen}`)}</h1>
      <div className="topbar-right">
        {!readOnly && <TopbarActions onOpenPalette={() => setPaletteOpen(true)} />}
        <Tooltip label={t("inbox.title")} placement="bottom">
          <button
            type="button"
            className="topbar-refresh-btn"
            onClick={() => setInboxOpen(true)}
            aria-label={t("inbox.open")}
            style={{ position: "relative" }}
          >
            <IconBell size={16} />
            {inboxUnread > 0 && (
              <span aria-hidden style={{
                position: "absolute", top: 3, right: 3,
                width: 9, height: 9, borderRadius: 999,
                background: "var(--red)", border: "1.5px solid var(--white)",
              }} />
            )}
          </button>
        </Tooltip>
        <Tooltip label={t("retry")} placement="bottom">
          <button className="topbar-refresh-btn" onClick={refresh} aria-label={t("retry")}><IconRefresh size={16} /></button>
        </Tooltip>
        {admin && !readOnly && (
          <button
            className="admin-btn"
            onClick={async () => {
              // Admin lives on the web only. On native (iOS /
              // Android Capacitor) the button hands off to Safari
              // / Chrome via AppLauncher — the user's existing
              // session there means they land directly in the
              // admin view without re-authenticating. Rationale:
              // (1) admin is one-user, never used by regular
              // therapists — it doesn't justify the bundle weight
              // or attack surface on every install;
              // (2) admin features (impersonation, encryption
              // recovery, billing grants) are sensitive enough
              // that keeping them off the mobile binary is
              // defensive both for App Store review and against
              // IPA reverse-engineering;
              // (3) admin operations are deliberate / desk-shaped
              // work, not "while walking around" work — the phone
              // isn't the natural surface.
              if (isNative()) {
                const { launchUrl } = await import("../../lib/nativeBrowser");
                await launchUrl("https://cardigan.mx/#admin");
              } else {
                navigate("admin");
              }
            }}>
            Admin
          </button>
        )}
        {/* Contextual help for the current screen. Lives in the topbar
            so it doesn't eat vertical space on each page. HelpTip
            returns null when the screen's tip array is empty. */}
        <HelpTip tipsKey={`help.${screen}`} />
        <Tooltip label={t("nav.settings")} placement="bottom">
          <button type="button" className="avatar-sm" onClick={() => navigate("settings")} aria-label={t("nav.settings")} style={{ cursor:"pointer", border:"none" }}>
            <span className="avatar-sm-circle">
              <AvatarContent initials={userInitial} imageUrl={avatarImageUrl} />
            </span>
          </button>
        </Tooltip>
      </div>
    </div>
  );
}
