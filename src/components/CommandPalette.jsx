import { useState, useEffect, useMemo, useRef } from "react";
import { IconSearch, IconX, IconUsers, IconCalendar, IconDollar, IconClipboard, IconDocument, IconHome, IconUserPlus, IconCalendarPlus } from "./Icons";
import { useCardigan } from "../context/CardiganContext";
import { useEscape } from "../hooks/useEscape";
import { useT } from "../i18n/index";

const NAV_COMMANDS = [
  { id: "nav:home",     group: "Navegar", labelKey: "nav.home",      screen: "home",     Icon: IconHome },
  { id: "nav:agenda",   group: "Navegar", labelKey: "nav.agenda",    screen: "agenda",   Icon: IconCalendar },
  { id: "nav:patients", group: "Navegar", labelKey: "nav.patients",  screen: "patients", Icon: IconUsers },
  { id: "nav:finances", group: "Navegar", labelKey: "nav.finances",  screen: "finances", Icon: IconDollar },
  { id: "nav:archivo",  group: "Navegar", labelKey: "nav.archivo",   screen: "archivo",  Icon: IconDocument },
  { id: "nav:settings", group: "Navegar", labelKey: "nav.settings",  screen: "settings", Icon: IconClipboard },
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
  const { navigate, patients, requestFabAction, openExpediente } = useCardigan();
  const [query, setQuery] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  useEscape(open ? onClose : null);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActiveIdx(0);
      // Focus on next tick so the animation can play first.
      const id = setTimeout(() => inputRef.current?.focus(), 40);
      return () => clearTimeout(id);
    }
  }, [open]);

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
    return [...navCmds, ...actionCmds, ...patientCmds];
  }, [patients, t, navigate, requestFabAction, openExpediente, onClose]);

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

  useEffect(() => { setActiveIdx(0); }, [query]);

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
            placeholder={t("cmdp.placeholder") || "Buscar comandos, pacientes\u2026"}
          />
          <kbd className="cmdp-kbd">ESC</kbd>
        </div>
        <div ref={listRef} className="cmdp-list" role="listbox">
          {!query.trim() && (
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
              <span className="cmdp-tip">
                <kbd className="cmdp-kbd">⌘K</kbd>
                <span>Abrir desde cualquier pantalla</span>
              </span>
            </div>
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
