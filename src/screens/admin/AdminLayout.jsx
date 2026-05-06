import { useState, useEffect, useCallback, useRef } from "react";
import { useAdminRoute } from "./useAdminRoute";
import {
  IconHome, IconUsers, IconDollar, IconTrendingUp, IconTag, IconBug, IconShield,
  IconActivity, IconMenu, IconX, IconChevronRight, IconArrowLeft, IconLogOut,
} from "../../components/Icons";
import { LogoIcon } from "../../components/LogoMark";
import { AdminOverview } from "./AdminOverview";
import { AdminUsers } from "./AdminUsers";
import { AdminUserDetail } from "./AdminUserDetail";
import { AdminRevenue } from "./AdminRevenue";
import { AdminAcquisition } from "./AdminAcquisition";
import { AdminCodes } from "./AdminCodes";
import { AdminReports } from "./AdminReports";
import { AdminAudit } from "./AdminAudit";
import { AdminHealth } from "./AdminHealth";

const SECTIONS = [
  { key: "overview",    label: "Resumen",     icon: IconHome,        group: "insights" },
  { key: "users",       label: "Usuarios",    icon: IconUsers,       group: "insights" },
  { key: "revenue",     label: "Ingresos",    icon: IconDollar,      group: "insights" },
  { key: "acquisition", label: "Adquisición", icon: IconTrendingUp,  group: "insights" },
  { key: "codes",       label: "Códigos",     icon: IconTag,         group: "ops" },
  { key: "reports",     label: "Reportes",    icon: IconBug,         group: "ops" },
  { key: "audit",       label: "Auditoría",   icon: IconShield,      group: "ops" },
  { key: "health",      label: "Salud",       icon: IconActivity,    group: "ops" },
];

const TITLE_BY_SECTION = {
  overview: "Resumen",
  users: "Usuarios",
  revenue: "Ingresos",
  acquisition: "Adquisición",
  codes: "Códigos",
  reports: "Reportes",
  audit: "Registro de auditoría",
  health: "Salud del sistema",
};

/* ── AdminLayout ──
   Shell + sidebar + header for the dedicated `#admin/...` family.
   Hash routing only — `useAdminRoute` parses the section and id, and
   navigation between pages updates `window.location.hash` via
   replaceState to avoid history spam (matches useNavigation's
   pattern). Leaving admin (Salir) navigates the parent router back to
   `#home`.

   On mobile (<900px) the rail collapses to a slide-in drawer behind
   a hamburger; on desktop it's a fixed 224px column. */
export function AdminLayout({ onViewAs, onLeaveAdmin, currentAdminId }) {
  const route = useAdminRoute();
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Close the mobile drawer when the section changes — without this,
  // tapping a section on a small viewport leaves the drawer open over
  // the new content. set-state-in-effect is the right shape here:
  // the drawer's "open" state is genuinely derived from the route,
  // not from its own external system.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setDrawerOpen(false); }, [route.section, route.id]);

  // Esc closes the mobile drawer.
  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e) => { if (e.key === "Escape") setDrawerOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawerOpen]);

  /* ── Edge-swipe gestures for the mobile drawer ──
     Mirrors the pattern in App.jsx for the main drawer:
     • Swipe-from-left-edge opens the drawer.
     • Swipe-left while open closes it.
     Uses native addEventListener with passive:false so we can
     preventDefault iOS Safari's edge-swipe-back gesture once we've
     committed to a horizontal drag. Skipped on viewports >900px
     where the rail is persistent (matches the CSS @media query). */
  const shellRef = useRef(null);
  const dragRef = useRef(null);
  const drawerOpenRef = useRef(drawerOpen);
  useEffect(() => { drawerOpenRef.current = drawerOpen; }, [drawerOpen]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const shell = shellRef.current;
    if (!shell) return;
    // Don't wire gestures when the rail is persistent — at >=900px
    // the drawer is always visible, so edge-swipe is meaningless and
    // would only fight in-page horizontal scrolling (e.g. tables).
    const isWide = () => window.innerWidth >= 900;

    const EDGE_BAND = 26;       // touchstart x must be ≤ this to engage
    const ENGAGE_PX = 10;       // horizontal travel before we claim the gesture
    const DISMISS_THRESHOLD = 60;
    const OPEN_THRESHOLD = 60;

    const onTouchStart = (e) => {
      if (isWide()) return;
      if (e.touches.length !== 1) return;
      const t = e.touches[0];
      if (drawerOpenRef.current) {
        // Swipe-to-close from anywhere on the panel/scrim while open.
        dragRef.current = { mode: "close", startX: t.clientX, startY: t.clientY, active: false };
      } else if (t.clientX <= EDGE_BAND) {
        // Swipe-to-open only from the left edge band so we don't
        // race in-page horizontal scrolling (tables, code blocks).
        dragRef.current = { mode: "open", startX: t.clientX, startY: t.clientY, active: false };
      } else {
        dragRef.current = null;
      }
    };

    const onTouchMove = (e) => {
      const drag = dragRef.current;
      if (!drag) return;
      const t = e.touches[0];
      const dx = t.clientX - drag.startX;
      const dy = t.clientY - drag.startY;
      if (!drag.active) {
        if (Math.abs(dx) > ENGAGE_PX && Math.abs(dx) > Math.abs(dy)) {
          // Horizontal commit. Suppress iOS Safari's native
          // edge-swipe-back peek for the OPEN gesture by
          // preventDefault'ing every subsequent move.
          drag.active = true;
        } else if (Math.abs(dy) > ENGAGE_PX) {
          dragRef.current = null;
          return;
        }
      }
      if (drag.active) {
        if (drag.mode === "open" && dx > 0 && e.cancelable) e.preventDefault();
        if (drag.mode === "close" && dx < 0 && e.cancelable) e.preventDefault();
      }
    };

    const onTouchEnd = (e) => {
      const drag = dragRef.current;
      dragRef.current = null;
      if (!drag || !drag.active) return;
      const t = (e.changedTouches && e.changedTouches[0]) || null;
      if (!t) return;
      const dx = t.clientX - drag.startX;
      if (drag.mode === "open" && dx > OPEN_THRESHOLD) setDrawerOpen(true);
      else if (drag.mode === "close" && dx < -DISMISS_THRESHOLD) setDrawerOpen(false);
    };

    const opts = { passive: false };
    shell.addEventListener("touchstart", onTouchStart, opts);
    shell.addEventListener("touchmove", onTouchMove, opts);
    shell.addEventListener("touchend", onTouchEnd, opts);
    shell.addEventListener("touchcancel", onTouchEnd, opts);
    return () => {
      shell.removeEventListener("touchstart", onTouchStart, opts);
      shell.removeEventListener("touchmove", onTouchMove, opts);
      shell.removeEventListener("touchend", onTouchEnd, opts);
      shell.removeEventListener("touchcancel", onTouchEnd, opts);
    };
  }, []);

  const goSection = useCallback((section) => {
    route.navigate(section);
  }, [route]);

  const handleViewAs = useCallback((uid) => {
    onViewAs?.(uid);
  }, [onViewAs]);

  // Build breadcrumbs. User Detail gets a parent crumb back to /users.
  const breadcrumbs = [];
  breadcrumbs.push({ label: "Admin", onClick: () => goSection("overview") });
  if (route.section === "users" && route.id) {
    breadcrumbs.push({ label: "Usuarios", onClick: () => goSection("users") });
    breadcrumbs.push({ label: "Detalle" });
  } else {
    breadcrumbs.push({ label: TITLE_BY_SECTION[route.section] || "Resumen" });
  }

  const insightsSections = SECTIONS.filter(s => s.group === "insights");
  const opsSections = SECTIONS.filter(s => s.group === "ops");

  let pageTitle = TITLE_BY_SECTION[route.section] || "Resumen";
  if (route.section === "users" && route.id) pageTitle = "Detalle de usuario";

  let body;
  switch (route.section) {
    case "users":
      body = route.id
        ? <AdminUserDetail uid={route.id} onViewAs={handleViewAs} onBack={() => goSection("users")} currentAdminId={currentAdminId} />
        : <AdminUsers onSelect={(uid) => route.navigate("users", uid)} />;
      break;
    case "revenue":     body = <AdminRevenue />; break;
    case "acquisition": body = <AdminAcquisition />; break;
    case "codes":       body = <AdminCodes />; break;
    case "reports":     body = <AdminReports />; break;
    case "audit":       body = <AdminAudit />; break;
    case "health":      body = <AdminHealth />; break;
    case "overview":
    default:
      body = <AdminOverview onJump={goSection} />;
  }

  return (
    <div className="admin-shell" ref={shellRef}>
      {drawerOpen && (
        <div className="admin-rail-scrim" onClick={() => setDrawerOpen(false)} aria-hidden="true" />
      )}
      <aside className={`admin-rail${drawerOpen ? " admin-rail--open" : ""}`} aria-label="Admin navigation">
        {/* Top zone — pinned. Bakes safe-area-top so the brand isn't
            crammed under the iOS status bar. */}
        <div className="admin-rail-brand">
          <LogoIcon size={18} color="currentColor" />
          <div>
            <div>cardigan</div>
            <div className="admin-rail-brand-meta">Admin</div>
          </div>
        </div>

        {/* Middle zone — only this scrolls (matches .drawer-nav).
            Long item lists or short viewports keep the brand and
            footer visible while the user scrolls between sections. */}
        <div className="admin-rail-nav">
          <div className="admin-rail-section-label">Insights</div>
          {insightsSections.map((s) => {
            const Icon = s.icon;
            const active = route.section === s.key;
            return (
              <button key={s.key} type="button"
                className={`admin-rail-item${active ? " admin-rail-item--active" : ""}`}
                onClick={() => goSection(s.key)}>
                <span className="admin-rail-icon"><Icon size={16} /></span>
                <span>{s.label}</span>
              </button>
            );
          })}

          <div className="admin-rail-section-label" style={{ marginTop: 6 }}>Operaciones</div>
          {opsSections.map((s) => {
            const Icon = s.icon;
            const active = route.section === s.key;
            return (
              <button key={s.key} type="button"
                className={`admin-rail-item${active ? " admin-rail-item--active" : ""}`}
                onClick={() => goSection(s.key)}>
                <span className="admin-rail-icon"><Icon size={16} /></span>
                <span>{s.label}</span>
              </button>
            );
          })}
        </div>

        {/* Bottom zone — pinned. Bakes safe-area-bottom so the
            "Salir" button stays clear of the home indicator. */}
        <div className="admin-rail-footer">
          <span className="admin-rail-badge">Modo administrador</span>
          <button type="button" className="admin-rail-item" onClick={() => onLeaveAdmin?.()}>
            <span className="admin-rail-icon"><IconLogOut size={16} /></span>
            <span>Salir</span>
          </button>
        </div>
      </aside>

      <main className="admin-main">
        <header className="admin-header">
          <div className="admin-header-row">
            <div className="admin-header-left">
              <button type="button" className="admin-hamburger" aria-label="Menu"
                onClick={() => setDrawerOpen((o) => !o)}>
                {drawerOpen ? <IconX size={18} /> : <IconMenu size={18} />}
              </button>
              {route.section === "users" && route.id && (
                <button type="button"
                  onClick={() => goSection("users")}
                  style={{
                    background: "none", border: "none", padding: 0, cursor: "pointer",
                    display: "inline-flex", alignItems: "center", color: "var(--charcoal-md)",
                  }}
                  aria-label="Volver">
                  <IconArrowLeft size={18} />
                </button>
              )}
              <nav className="admin-breadcrumbs" aria-label="Breadcrumb">
                {breadcrumbs.map((c, i) => (
                  <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                    {i > 0 && <span className="admin-breadcrumb-sep"><IconChevronRight size={12} /></span>}
                    {c.onClick ? <button type="button" onClick={c.onClick}>{c.label}</button> : <span>{c.label}</span>}
                  </span>
                ))}
              </nav>
            </div>
            <h1 className="admin-page-title">{pageTitle}</h1>
            <div className="admin-header-actions">
              {/* Page-specific actions (e.g. "Nuevo código") are rendered
                  inside each page rather than plumbed through here — keeps
                  pages self-contained and the layout stable. */}
              <button type="button" className="admin-exit-btn" onClick={() => onLeaveAdmin?.()}
                aria-label="Salir de admin" title="Salir de admin">
                <IconX size={16} />
              </button>
            </div>
          </div>
        </header>

        <div className="admin-content">
          {/* The key on this wrapper restarts the fade animation on
              every section/id change so the body swap reads as
              motion, not a hard cut. position:fixed shell can't ride
              the global screen slide, so we add our own subtle cue. */}
          <div className="admin-content-inner admin-page-fade" key={`${route.section}:${route.id || ""}`}>
            {body}
          </div>
        </div>
      </main>
    </div>
  );
}
