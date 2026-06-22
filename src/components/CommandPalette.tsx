import { useState, useEffect, useMemo, useRef } from "react";
import { IconSearch, IconX, IconUsers, IconCalendar, IconDollar, IconClipboard, IconDocument, IconHome, IconUserPlus, IconCalendarPlus, IconShield, IconBarChart, IconTrendingUp, IconTag, IconBug, IconActivity } from "./Icons";
import { useCardigan } from "../context/CardiganContext";
import { useEscape } from "../hooks/useEscape";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { useViewport } from "../hooks/useViewport";
import { useT } from "../i18n/index";
import { fetchAllAccounts } from "../hooks/useCardiganData";
import { useAdminCommands, recordAdminRecent } from "../screens/admin/parts/useAdminCommands";
import { isNative } from "../lib/platform";
import { supabase } from "../supabaseClient";
import { tokenize, matches, buildExcerpt } from "../utils/noteSearch";

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

// Note/patient rows arrive through the loosely-typed Cardigan data
// layer (useCardigan returns Record<string, any>); model them as Row
// at the callback boundary rather than threading a precise shape.
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- migration bridge for loosely-typed data rows
type Row = any;

interface Command {
  id: string;
  group: string;
  label: string;
  sublabel?: string | null;
  Icon?: React.ComponentType<{ size?: number }>;
  pinned?: boolean;
  run: () => void;
}

type GroupedRow =
  | { type: "header"; label: string }
  | { type: "item"; cmd: Command; idx: number };

function score(query: string, text: string) {
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

export default function CommandPalette({ open, onClose, onViewAsUser, currentAdminId }: {
  open?: boolean;
  onClose: () => void;
  onViewAsUser?: (id: string) => void;
  currentAdminId?: string;
}) {
  const { t } = useT();
  // Keyboard hints (ESC chip, ↑↓ tips, mod-key shortcuts, footer) only
  // mean something on a device with an actual keyboard. iPhone users
  // see them as cosmetic clutter — hide everywhere below the tablet
  // breakpoint. iPad portrait + landscape still show them since a
  // Magic Keyboard / external BT keyboard is common there.
  const { isTablet } = useViewport();
  const { navigate, patients, notes, requestFabAction, openExpediente, openNoteById, noteCrypto, isAdminUser, showToast } = useCardigan();
  // Admin features are web-only — see the rationale on the topbar
  // admin button in App.jsx. The palette's admin commands (Open
  // user / Grant comp / View as / etc.) operate on routes that
  // don't exist on native, so suppress them entirely on Capacitor.
  const adminAvailable = isAdminUser && !isNative();
  // Admin account list — lazy-fetched the first time the palette opens
  // for an admin so non-admin sessions never make this round-trip.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- admin account rows from the loosely-typed fetchAllAccounts
  const [adminAccounts, setAdminAccounts] = useState<any[]>([]);
  const adminFetchedRef = useRef(false);
  const [query, setQuery] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const panelRef = useFocusTrap(!!open);

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
    if (!open || !adminAvailable || adminFetchedRef.current) return;
    adminFetchedRef.current = true;
    fetchAllAccounts()
      .then((rows) => setAdminAccounts(rows || []))
      .catch(() => { adminFetchedRef.current = false; });
  }, [open, adminAvailable]);

  // Admin-only type-to-act parser + recent items. Returns synthetic
  // commands prefixed by verb (block/comp/view as/etc.) plus a recent
  // list when no query is typed.
  const adminCmds = useAdminCommands({
    query,
    adminAccounts,
    isAdminUser: adminAvailable,
    navigate,
    onClose,
    showToast,
    onViewAs: onViewAsUser,
    currentAdminId,
  });

  // ── Note search (Phase 1.2) ────────────────────────────────────
  // Two paths:
  //   • Encrypted users (noteCrypto.isEnabled) → in-memory filter over
  //     the decrypted `notes` cache. The server-side tsvector index
  //     has empty content for encrypted rows (only title is searchable
  //     server-side), so we'd miss body matches if we hit the RPC.
  //   • Unencrypted users → RPC against the GIN-backed search_notes
  //     function. Catches the long-tail of notes older than the
  //     500-row cap useCardiganData loads into memory, and gets
  //     server-side ts_rank for free.
  // Debounced 200ms so a fast typist doesn't issue an RPC per keystroke.
  const [rpcNoteHits, setRpcNoteHits] = useState<string[]>([]);
  const encryptionEnabled = !!noteCrypto?.isEnabled;
  // RPC search effect. When the query is empty / palette closed /
  // user is on the encrypted lane, the in-memory filter below covers
  // it and we don't read rpcNoteHits — no need to clear it from an
  // effect (which the lint rule rightly flags). The async setTimeout
  // is the only setState path, and it cancels on cleanup.
  useEffect(() => {
    if (!open) return;
    const q = (query || "").trim();
    if (!q || encryptionEnabled) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      const { data, error } = await supabase.rpc("search_notes", { p_query: q, p_limit: 8 });
      if (cancelled) return;
      if (error || !Array.isArray(data)) { setRpcNoteHits([]); return; }
      setRpcNoteHits(data.map(r => r.id));
    }, 200);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [open, query, encryptionEnabled]);

  // Build the notes-result list. Encrypted users get the in-memory
  // filter; unencrypted users get the union of in-memory hits and
  // RPC hits (id-deduped so the same row doesn't appear twice).
  const noteHits = useMemo(() => {
    const q = (query || "").trim();
    if (!q) return [];
    const terms = tokenize(q);
    const inMemory = (notes || []).filter((n: Row) => {
      const patient = n.patient_id ? (patients || []).find((p: Row) => p.id === n.patient_id) : null;
      return matches(n, patient, terms);
    });
    if (encryptionEnabled) return inMemory.slice(0, 8);
    const inMemIds = new Set(inMemory.map((n: Row) => n.id));
    const rpcOnly = rpcNoteHits
      .filter(id => !inMemIds.has(id))
      .map(id => (notes || []).find((n: Row) => n.id === id))
      .filter(Boolean);
    return [...inMemory, ...rpcOnly].slice(0, 8);
  }, [notes, patients, query, encryptionEnabled, rpcNoteHits]);

  const commands = useMemo<Command[]>(() => {
    const navCmds = NAV_COMMANDS.map((c) => ({ ...c, label: t(c.labelKey), run: () => { navigate(c.screen); onClose(); } }));
    const actionCmds = ACTION_COMMANDS.map((c) => ({ ...c, label: t(c.labelKey), run: () => { requestFabAction?.(c.fabKey); onClose(); } }));
    const patientCmds = (patients || []).map((p: Row) => ({
      id: `patient:${p.id}`,
      group: "Pacientes",
      label: p.name,
      Icon: IconUsers,
      run: () => { openExpediente?.(p); onClose(); },
    }));
    // Note search results — only when the user has typed a query.
    // Pre-scored as "pinned" so the standard fuzzy-score filter below
    // doesn't re-score the label (which is just the note title + a
    // body excerpt, not a deterministic match string).
    const queryTerms = tokenize((query || "").trim());
    const noteCmds = noteHits.map((n: Row) => {
      const patient = n.patient_id ? (patients || []).find((p: Row) => p.id === n.patient_id) : null;
      const title = (n.title || "").trim() || (patient ? `Nota · ${patient.name}` : "Nota sin título");
      const excerpt = buildExcerpt(n, queryTerms, 80);
      return {
        id: `note:${n.id}`,
        group: "Notas",
        label: title,
        sublabel: excerpt || (patient ? patient.name : null),
        Icon: IconClipboard,
        pinned: true, // skip fuzzy re-score; results are already ranked
        run: () => { openNoteById?.(n.id); onClose(); },
      };
    });
    const adminNavCmds = adminAvailable
      ? ADMIN_COMMANDS.map((c) => ({ ...c, run: () => { navigate(c.target); onClose(); } }))
      : [];
    const adminAccountCmds = adminAvailable
      ? adminAccounts.map((a: Row) => ({
          id: `adminUser:${a.userId}`,
          group: "Admin · usuarios",
          label: a.fullName ? `${a.fullName} · ${a.email || ""}` : (a.email || a.userId.slice(0, 8) + "…"),
          Icon: IconUsers,
          run: () => {
            recordAdminRecent(`admin:user:${a.userId}`);
            navigate(`admin/users/${a.userId}`);
            onClose();
          },
        }))
      : [];
    // Order: Recent (no-query only) → Acciones rápidas (verb-prefixed) →
    // navigate / actions / patients / notes / admin nav / admin accounts.
    return [
      ...adminCmds.recent,
      ...adminCmds.typeToAct,
      ...noteCmds, // pinned (pre-ranked); appears near the top when a query is active
      ...navCmds,
      ...actionCmds,
      ...adminNavCmds,
      ...patientCmds,
      ...adminAccountCmds,
    ];
  }, [patients, query, noteHits, t, navigate, requestFabAction, openExpediente, openNoteById, onClose, adminAvailable, adminAccounts, adminCmds]);

  const filtered = useMemo(() => {
    if (!query.trim()) {
      // No query: show everything ordered by group (pinned items already
      // at the head of `commands`).
      return commands;
    }
    // Pinned commands (admin type-to-act + recent) skip fuzzy scoring —
    // they're already context-relevant to the query (verb-prefix matched
    // upstream). The rest are filtered by score and sorted.
    const pinned = commands.filter((c) => c.pinned);
    const rest = commands
      .filter((c) => !c.pinned)
      .map((c) => ({ cmd: c, s: score(query, c.label) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .map((x) => x.cmd);
    return [...pinned, ...rest];
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

  const onKeyDown = (e: React.KeyboardEvent) => {
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
  const grouped: GroupedRow[] = [];
  let lastGroup: string | null = null;
  filtered.forEach((cmd, idx) => {
    if (cmd.group !== lastGroup) {
      grouped.push({ type: "header", label: cmd.group });
      lastGroup = cmd.group;
    }
    grouped.push({ type: "item", cmd, idx });
  });

  return (
    <div className="cmdp-overlay" onClick={onClose}>
      <div ref={(el) => { panelRef.current = el; }} className="cmdp-panel" role="dialog" aria-modal="true" aria-label="Command palette" onClick={(e) => e.stopPropagation()}>
        <div className="cmdp-search">
          <IconSearch size={16} />
          <input
            ref={inputRef}
            type="search"
            aria-label={t("cmdp.placeholder")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={t("cmdp.placeholder")}
          />
          {isTablet && <kbd className="cmdp-kbd">ESC</kbd>}
        </div>
        <div ref={listRef} className="cmdp-list" role="listbox">
          {!query.trim() && isTablet && (
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
            <div className="cmdp-empty">
              <div style={{ fontWeight: 700, color: "var(--charcoal)", marginBottom: 4 }}>
                {t("cmdp.empty") || "Sin resultados"}
              </div>
              <div style={{ fontSize: 12, color: "var(--charcoal-xl)" }}>
                {t("cmdp.emptyHint") || "Prueba con un nombre de paciente o una sección."}
              </div>
            </div>
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
                <span className="cmdp-item-label">
                  {row.cmd.label}
                  {row.cmd.sublabel && (
                    <span style={{
                      display: "block",
                      fontSize: 11, fontWeight: 500,
                      color: "var(--charcoal-xl)",
                      marginTop: 2,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}>{row.cmd.sublabel}</span>
                  )}
                </span>
              </button>
            ))
          )}
        </div>
        {isTablet && (
          <div className="cmdp-footer">
            <span className="cmdp-footer-hint"><kbd className="cmdp-kbd">↑</kbd><kbd className="cmdp-kbd">↓</kbd> Navegar</span>
            <span className="cmdp-footer-hint"><kbd className="cmdp-kbd">↵</kbd> Abrir</span>
            <span className="cmdp-footer-hint"><kbd className="cmdp-kbd">esc</kbd> Cerrar</span>
          </div>
        )}
      </div>
    </div>
  );
}
