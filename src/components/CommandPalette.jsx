import { useState, useEffect, useMemo, useRef } from "react";
import { IconSearch, IconX, IconUsers, IconCalendar, IconDollar, IconClipboard, IconDocument, IconHome, IconUserPlus, IconCalendarPlus, IconShield, IconBarChart, IconTrendingUp, IconTag, IconBug, IconActivity } from "./Icons";
import { useCardigan } from "../context/CardiganContext";
import { useEscape } from "../hooks/useEscape";
import { useT } from "../i18n/index";
import { fetchAllAccounts } from "../hooks/useCardiganData";

const NAV_COMMANDS = [
  { id: "nav:home",     group: "Navegar", labelKey: "nav.home",      screen: "home",     Icon: IconHome },
  { id: "nav:agenda",   group: "Navegar", labelKey: "nav.agenda",    screen: "agenda",   Icon: IconCalendar },
  { id: "nav:patients", group: "Navegar", labelKey: "nav.patients",  screen: "patients", Icon: IconUsers },
  { id: "nav:finances", group: "Navegar", labelKey: "nav.finances",  screen: "finances", Icon: IconDollar },
  { id: "nav:archivo",  group: "Navegar", labelKey: "nav.archivo",   screen: "archivo",  Icon: IconDocument },
  { id: "nav:settings", group: "Navegar", labelKey: "nav.settings",  screen: "settings", Icon: IconClipboard },
];

// Admin nav commands. Surfaced ONLY when ctx.isAdminUser is true. Each
// runs `navigate("admin/<section>")` so the per-section URL is
// deep-linkable and the admin layout's useAdminRoute hook reads it on
// mount.
const ADMIN_COMMANDS = [
  { id: "admin:overview",    group: "Admin", label: "Admin · Resumen",      target: "admin/overview",    Icon: IconHome },
  { id: "admin:users",       group: "Admin", label: "Admin · Usuarios",     target: "admin/users",       Icon: IconUsers },
  { id: "admin:revenue",     group: "Admin", label: "Admin · Ingresos",     target: "admin/revenue",     Icon: IconDollar },
  { id: "admin:acquisition", group: "Admin", label: "Admin · Adquisición",  target: "admin/acquisition", Icon: IconTrendingUp },
  { id: "admin:codes",       group: "Admin", label: "Admin · Códigos",      target: "admin/codes",       Icon: IconTag },
  { id: "admin:reports",     group: "Admin", label: "Admin · Reportes",     target: "admin/reports",     Icon: IconBug },
  { id: "admin:audit",       group: "Admin", label: "Admin · Auditoría",    target: "admin/audit",       Icon: IconShield },
  { id: "admin:health",      group: "Admin", label: "Admin · Salud",        target: "admin/health",      Icon: IconActivity },
  { id: "admin:metrics",     group: "Admin", label: "Admin · Métricas",     target: "admin/overview",    Icon: IconBarChart },
];

const ACTION_COMMANDS = [
  { id: "action:patient",  group: "Crear",     labelKey: "fab.patient",  fabKey: "patient",  Icon: IconUserPlus },
  { id: "action:session",  group: "Crear",     labelKey: "fab.session",  fabKey: "session",  Icon: IconCalendarPlus },
  { id: "action:payment",  group: "Crear",     labelKey: "fab.payment",  fabKey: "payment",  Icon: IconDollar },
  { id: "action:note",     group: "Crear",     labelKey: "fab.note",     fabKey: "note",     Icon: IconClipboard },
  { id: "action:document", group: "Crear",     labelKey: "fab.document", fabKey: "document", Icon: IconDocument },
];

function score(query, text) {
  if (!query) return 1;
  const q = query.toLowerCase();
  const t = (text || "").toLowerCase();
  if (t.startsWith(q)) return 3;
  if (t.includes(q)) return 2;
  // Weak fuzzy: all chars appear in order
  let i = 0;
  for (const c of t) { if (c === q[i]) i++; if (i === q.length) return 1; }
  return 0;
}

export default function CommandPalette({ open, onClose }) {
  const { t } = useT();
  const { navigate, patients, requestFabAction, openExpediente, isAdminUser } = useCardigan();
  // Admin account list — lazy-fetched the first time the palette opens
  // for an admin so non-admin sessions never make this round-trip.
  const [adminAccounts, setAdminAccounts] = useState([]);
  const adminFetchedRef = useRef(false);
  const [query, setQuery] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  useEscape(open ? onClose : null);

  // Reset query + selection when the palette opens. "Adjust state
   //   during render" is the React-recommended pattern for responding to
   //   a prop flip without the set-state-in-effect cascade.
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setQuery("");
      setActiveIdx(0);
    }
  }
  useEffect(() => {
    if (!open) return;
    // Focus on next tick so the animation can play first.
    const id = setTimeout(() => inputRef.current?.focus(), 40);
    return () => clearTimeout(id);
  }, [open]);

  // First-open lazy fetch of every account so the admin can jump to
  // any user's detail page from the palette. Skipped for non-admins.
  useEffect(() => {
    if (!open || !isAdminUser || adminFetchedRef.current) return;
    adminFetchedRef.current = true;
    fetchAllAccounts()
      .then((rows) => setAdminAccounts(rows || []))
      .catch(() => { adminFetchedRef.current = false; });
  }, [open, isAdminUser]);

  const commands = useMemo(() => {
    const navCmds = NAV_COMMANDS.map((c) => ({ ...c, label: t(c.labelKey), run: () => { navigate(c.screen); onClose(); } }));
    const actionCmds = ACTION_COMMANDS.map((c) => ({ ...c, label: t(c.labelKey), run: () => { requestFabAction?.(c.fabKey); onClose(); } }));
    const patientCmds = (patients || []).map((p) => ({
      id: `patient:${p.id}`,
      group: "Pacientes",
      label: p.name,
      Icon: IconUsers,
      run: () => { openExpediente?.(p); onClose(); },
    }));
    const adminNavCmds = isAdminUser
      ? ADMIN_COMMANDS.map((c) => ({ ...c, run: () => { navigate(c.target); onClose(); } }))
      : [];
    const adminAccountCmds = isAdminUser
      ? adminAccounts.map((a) => ({
          id: `adminUser:${a.userId}`,
          group: "Admin · usuarios",
          label: a.fullName ? `${a.fullName} · ${a.email || ""}` : (a.email || a.userId.slice(0, 8) + "…"),
          Icon: IconUsers,
          run: () => { navigate(`admin/users/${a.userId}`); onClose(); },
        }))
      : [];
    return [...navCmds, ...actionCmds, ...adminNavCmds, ...patientCmds, ...adminAccountCmds];
  }, [patients, t, navigate, requestFabAction, openExpediente, onClose, isAdminUser, adminAccounts]);

  const filtered = useMemo(() => {
    if (!query.trim()) {
      // No query: show everything ordered by group
      return commands;
    }
    return commands
      .map((c) => ({ cmd: c, s: score(query, c.label) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .map((x) => x.cmd);
  }, [commands, query]);

  // Reset selection to the top whenever the query changes (new filtered list).
  const [prevQuery, setPrevQuery] = useState(query);
  if (query !== prevQuery) {
    setPrevQuery(query);
    setActiveIdx(0);
  }

  // Scroll active item into view
  useEffect(() => {
    if (!listRef.current) return;
    const el = listRef.current.querySelector(`[data-idx="${activeIdx}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [activeIdx]);

  if (!open) return null;

  const onKeyDown = (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const cmd = filtered[activeIdx];
      if (cmd) cmd.run();
    }
  };

  // Group consecutive items with the same group label so we can render headers.
  const grouped = [];
  let lastGroup = null;
  filtered.forEach((cmd, idx) => {
    if (cmd.group !== lastGroup) {
      grouped.push({ type: "header", label: cmd.group });
      lastGroup = cmd.group;
    }
    grouped.push({ type: "item", cmd, idx });
  });

  return (
    <div className="cmdp-overlay" onClick={onClose}>
      <div className="cmdp-panel" role="dialog" aria-modal="true" aria-label="Command palette" onClick={(e) => e.stopPropagation()}>
        <div className="cmdp-search">
          <IconSearch size={16} />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={t("cmdp.placeholder")}
          />
          <kbd className="cmdp-kbd">ESC</kbd>
        </div>
        <div ref={listRef} className="cmdp-list" role="listbox">
          {!query.trim() && (
            <>
              <div className="cmdp-tips" aria-hidden>
                <span className="cmdp-tip">
                  <kbd className="cmdp-kbd">↑</kbd><kbd className="cmdp-kbd">↓</kbd>
                  <span>Navegar</span>
                </span>
                <span className="cmdp-tip">
                  <kbd className="cmdp-kbd">↵</kbd>
                  <span>Abrir</span>
                </span>
                <span className="cmdp-tip">
                  <kbd className="cmdp-kbd">esc</kbd>
                  <span>Cerrar</span>
                </span>
              </div>
              <div className="cmdp-tips cmdp-tips--shortcuts" aria-hidden>
                <span className="cmdp-tip">
                  <kbd className="cmdp-kbd">⌘K</kbd><kbd className="cmdp-kbd">/</kbd>
                  <span>Abrir este buscador</span>
                </span>
                <span className="cmdp-tip">
                  <kbd className="cmdp-kbd">⌘N</kbd>
                  <span>{t("cmdp.newPatient")}</span>
                </span>
                <span className="cmdp-tip">
                  <kbd className="cmdp-kbd">g</kbd>
                  <kbd className="cmdp-kbd">h</kbd><kbd className="cmdp-kbd">a</kbd><kbd className="cmdp-kbd">p</kbd><kbd className="cmdp-kbd">f</kbd><kbd className="cmdp-kbd">n</kbd>
                  <span>Ir a pantalla</span>
                </span>
              </div>
            </>
          )}
          {filtered.length === 0 ? (
            <div className="cmdp-empty">{t("cmdp.empty") || "Sin resultados"}</div>
          ) : (
            grouped.map((row, i) => row.type === "header" ? (
              <div key={`h${i}`} className="cmdp-group-header">{row.label}</div>
            ) : (
              <button
                key={row.cmd.id}
                type="button"
                role="option"
                data-idx={row.idx}
                aria-selected={row.idx === activeIdx}
                className={`cmdp-item ${row.idx === activeIdx ? "cmdp-item--active" : ""}`}
                onMouseEnter={() => setActiveIdx(row.idx)}
                onClick={() => row.cmd.run()}
              >
                {row.cmd.Icon && <span className="cmdp-item-icon"><row.cmd.Icon size={15} /></span>}
                <span className="cmdp-item-label">{row.cmd.label}</span>
              </button>
            ))
          )}
        </div>
        <div className="cmdp-footer">
          <span className="cmdp-footer-hint"><kbd className="cmdp-kbd">↑</kbd><kbd className="cmdp-kbd">↓</kbd> Navegar</span>
          <span className="cmdp-footer-hint"><kbd className="cmdp-kbd">↵</kbd> Abrir</span>
          <span className="cmdp-footer-hint"><kbd className="cmdp-kbd">esc</kbd> Cerrar</span>
        </div>
      </div>
    </div>
  );
}
