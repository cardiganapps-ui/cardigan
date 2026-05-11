import { useMemo } from "react";
import {
  adminBlockUser,
  adminGrantComp,
  logAdminViewAs,
} from "../../../hooks/useCardiganData";
import {
  IconShield, IconCheck, IconUserPlus, IconTrash, IconX,
} from "../../../components/Icons";

/* ── useAdminCommands ──────────────────────────────────────────────────
   Type-to-act extension for CommandPalette. Detects verb-prefix queries
   ("block jane@", "comp ana", "view as user@…", "unblock x@") and
   returns synthetic command cards that fire the corresponding admin
   action on Enter.

   Non-destructive verbs (block/unblock/comp/view-as) fire immediately
   and surface a success toast. Destructive verbs (delete) require
   the admin to drill into the user detail page where the typed-confirm
   gate lives — this hook surfaces a "navigate" card for delete, not
   an inline run, so an accidental Enter on "delete jane" can't wipe
   an account.

   Recent-items tracking lives in localStorage under
   `admin.cmdp.recent` (capped at 5).

   Returns: { commands: Command[], parsedVerb: string | null,
              parsedQuery: string }
   `parsedVerb` lets the palette show a hint ("Acción: bloquear");
   `parsedQuery` is the remainder for caller-level matching if needed. */

const RECENT_KEY = "admin.cmdp.recent";
const RECENT_CAP = 5;

const VERBS = [
  { prefix: "view as ",  key: "view_as",       danger: false, Icon: IconShield, label: "Ver como" },
  { prefix: "comp ",     key: "comp",          danger: false, Icon: IconUserPlus, label: "Comp" },
  { prefix: "uncomp ",   key: "uncomp",        danger: false, Icon: IconX,      label: "Quitar comp" },
  { prefix: "block ",    key: "block",         danger: true,  Icon: IconShield, label: "Bloquear" },
  { prefix: "unblock ",  key: "unblock",       danger: false, Icon: IconCheck,  label: "Desbloquear" },
  { prefix: "delete ",   key: "delete",        danger: true,  Icon: IconTrash,  label: "Eliminar" },
];

function readRecent() {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(0, RECENT_CAP) : [];
  } catch { return []; }
}

function pushRecent(id) {
  if (typeof window === "undefined" || !id) return;
  try {
    const cur = readRecent();
    const next = [id, ...cur.filter((x) => x !== id)].slice(0, RECENT_CAP);
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch { /* non-fatal */ }
}

function parseQuery(query) {
  const q = (query || "").toLowerCase();
  for (const v of VERBS) {
    if (q.startsWith(v.prefix)) {
      return { verb: v, query: query.slice(v.prefix.length).trim() };
    }
  }
  return { verb: null, query };
}

function matchAccounts(accounts, query) {
  if (!query) return [];
  const q = query.toLowerCase();
  return accounts
    .filter((a) => {
      const hay = `${a.fullName || ""} ${a.email || ""}`.toLowerCase();
      return hay.includes(q);
    })
    .slice(0, 6);
}

export function useAdminCommands({
  query,
  adminAccounts,
  isAdminUser,
  navigate,
  onClose,
  showToast,
  onViewAs,
}) {
  const { verb, query: rest } = useMemo(() => parseQuery(query), [query]);

  const commands = useMemo(() => {
    if (!isAdminUser) return { typeToAct: [], recent: [] };

    // Recent items: only shown when no query is typed.
    const recentIds = readRecent();
    const recentCmds = !query.trim()
      ? recentIds
          .map((id) => {
            if (id.startsWith("admin:user:")) {
              const uid = id.slice("admin:user:".length);
              const acc = (adminAccounts || []).find((a) => a.userId === uid);
              if (!acc) return null;
              return {
                id,
                group: "Recientes",
                label: acc.fullName ? `${acc.fullName} · ${acc.email || ""}` : (acc.email || uid.slice(0, 8) + "…"),
                Icon: IconUserPlus,
                pinned: true,
                run: () => { pushRecent(id); navigate(`admin/users/${uid}`); onClose(); },
              };
            }
            return null;
          })
          .filter(Boolean)
      : [];

    if (!verb || !rest) {
      return { typeToAct: [], recent: recentCmds };
    }

    const matches = matchAccounts(adminAccounts || [], rest);
    if (matches.length === 0) return { typeToAct: [], recent: recentCmds };

    const typeToAct = matches.map((a) => {
      const userLabel = a.fullName ? `${a.fullName}` : (a.email || a.userId.slice(0, 8) + "…");
      const cmdId = `admin:typeact:${verb.key}:${a.userId}`;
      const showError = (msg) => showToast?.(msg, "error");
      const showOk = (msg) => showToast?.(msg, "success");

      return {
        id: cmdId,
        group: "Acciones rápidas",
        label: `${verb.label} · ${userLabel}`,
        sub: a.email,
        pinned: true,
        Icon: verb.Icon,
        danger: verb.danger,
        run: async () => {
          pushRecent(`admin:user:${a.userId}`);
          onClose();
          try {
            if (verb.key === "view_as") {
              await logAdminViewAs(a.userId);
              onViewAs?.(a.userId);
              return;
            }
            if (verb.key === "block") {
              await adminBlockUser(a.userId, true);
              showOk(`Bloqueado: ${userLabel}`);
              return;
            }
            if (verb.key === "unblock") {
              await adminBlockUser(a.userId, false);
              showOk(`Desbloqueado: ${userLabel}`);
              return;
            }
            if (verb.key === "comp") {
              await adminGrantComp(a.userId, true);
              showOk(`Comp otorgada: ${userLabel}`);
              return;
            }
            if (verb.key === "uncomp") {
              await adminGrantComp(a.userId, false);
              showOk(`Comp revocada: ${userLabel}`);
              return;
            }
            if (verb.key === "delete") {
              // Destructive — route to the user detail page where the
              // typed-confirm gate lives. Never run inline from cmdp.
              navigate(`admin/users/${a.userId}`);
              showToast?.("Confirma la eliminación en el detalle del usuario.", "info");
              return;
            }
          } catch (e) {
            showError(e?.message || "Error en la acción");
          }
        },
      };
    });
    return { typeToAct, recent: recentCmds };
  }, [verb, rest, query, adminAccounts, isAdminUser, navigate, onClose, showToast, onViewAs]);

  return {
    typeToAct: commands.typeToAct,
    recent: commands.recent,
    parsedVerb: verb?.label || null,
  };
}

/* Exported for callers that want to bump a recent entry without
   going through the hook (e.g. an account-jump click from the
   palette's existing adminAccountCmds). */
export function recordAdminRecent(id) {
  pushRecent(id);
}
