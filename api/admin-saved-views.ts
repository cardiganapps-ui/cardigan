/* ── /api/admin-saved-views ───────────────────────────────────────────
   Admin-only CRUD for the shared saved-views dropdown that hangs off
   AdminFilterBar. Lives in `admin_saved_views` (migration 063).

     GET    ?screen=users  → list views for one screen, newest first
     POST   { screen, name, filterState }     → create
     PATCH  { id, name?, filterState? }       → rename / update payload
     DELETE { id }                            → remove

   Every path requires the caller's JWT to belong to an admin (per
   the `is_admin()` SQL helper). Reads + writes go through the
   service-role client so RLS is bypassed; the auth check at the
   endpoint level is the gate.

   No per-row ownership: any admin can edit / delete any saved view.
   The use case is shared playbooks across the admin team. `created_by`
   is recorded for audit but never used for ACL.
*/

import { requireAdmin, getServiceClient, logAuditEvent } from "./_admin.js";
import { withSentry } from "./_sentry.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any;

const SCREENS = new Set([
  "users", "audit", "revenue", "acquisition", "codes", "reports",
]);

function bad(res: Row, msg: Row, code = 400) {
  return res.status(code).json({ error: msg });
}

function validateName(name: Row) {
  if (typeof name !== "string") return "Nombre inválido";
  const trimmed = name.trim();
  if (trimmed.length < 1 || trimmed.length > 60) return "Nombre debe tener 1-60 caracteres";
  return null;
}

function validateFilterState(state: Row) {
  if (state == null || typeof state !== "object" || Array.isArray(state)) return "filterState inválido";
  // 4 KB cap — same as the DB check constraint, surfaced earlier so
  // the client gets a clean 400 instead of a 500 from a constraint
  // violation.
  let bytes: number;
  try { bytes = Buffer.byteLength(JSON.stringify(state), "utf8"); }
  catch { return "filterState no serializable"; }
  if (bytes > 4096) return "filterState excede 4 KB";
  return null;
}

async function handleList(req: Row, res: Row) {
  const screen = req.query?.screen;
  if (screen && !SCREENS.has(screen)) return bad(res, "screen inválido");
  const svc = getServiceClient();
  let q = svc.from("admin_saved_views")
    .select("id, screen, name, filter_state, created_by, created_at, updated_at")
    .order("created_at", { ascending: false })
    .limit(200);
  if (screen) q = q.eq("screen", screen);
  const { data, error } = await q;
  if (error) return bad(res, "List failed", 500);
  return res.status(200).json({ views: data || [] });
}

async function handleCreate(req: Row, res: Row, admin: Row) {
  const body = req.body || {};
  if (!SCREENS.has(body.screen)) return bad(res, "screen inválido");
  const nameErr = validateName(body.name);
  if (nameErr) return bad(res, nameErr);
  const stateErr = validateFilterState(body.filterState);
  if (stateErr) return bad(res, stateErr);

  const svc = getServiceClient();
  const { data, error } = await svc.from("admin_saved_views")
    .insert({
      screen: body.screen,
      name: body.name.trim(),
      filter_state: body.filterState,
      created_by: admin.id,
    })
    .select("id, screen, name, filter_state, created_by, created_at, updated_at")
    .single();
  if (error) return bad(res, "Insert failed", 500);
  // Best-effort audit log. Logging failures never block the user op.
  await logAuditEvent(svc, {
    actorId: admin.id,
    action: "saved_view_create",
    payload: { id: data.id, screen: data.screen, name: data.name },
    req,
  });
  return res.status(200).json({ view: data });
}

async function handleUpdate(req: Row, res: Row, admin: Row) {
  const body = req.body || {};
  if (!body.id || typeof body.id !== "string") return bad(res, "id requerido");
  const updates: Row = {};
  if (body.name !== undefined) {
    const nameErr = validateName(body.name);
    if (nameErr) return bad(res, nameErr);
    updates.name = body.name.trim();
  }
  if (body.filterState !== undefined) {
    const stateErr = validateFilterState(body.filterState);
    if (stateErr) return bad(res, stateErr);
    updates.filter_state = body.filterState;
  }
  if (Object.keys(updates).length === 0) return bad(res, "Nada para actualizar");

  const svc = getServiceClient();
  const { data, error } = await svc.from("admin_saved_views")
    .update(updates)
    .eq("id", body.id)
    .select("id, screen, name, filter_state, created_by, created_at, updated_at")
    .single();
  if (error) return bad(res, "Update failed", 500);
  if (!data) return bad(res, "View no encontrada", 404);
  await logAuditEvent(svc, {
    actorId: admin.id,
    action: "saved_view_update",
    payload: {
      id: data.id,
      screen: data.screen,
      changedKeys: Object.keys(updates),
    },
    req,
  });
  return res.status(200).json({ view: data });
}

async function handleDelete(req: Row, res: Row, admin: Row) {
  const body = req.body || {};
  const id = body.id || req.query?.id;
  if (!id || typeof id !== "string") return bad(res, "id requerido");
  const svc = getServiceClient();
  // Read row before delete so the audit payload retains the screen +
  // name (otherwise the audit row is just an orphaned id).
  const { data: prior } = await svc.from("admin_saved_views")
    .select("id, screen, name").eq("id", id).maybeSingle();
  const { error } = await svc.from("admin_saved_views").delete().eq("id", id);
  if (error) return bad(res, "Delete failed", 500);
  await logAuditEvent(svc, {
    actorId: admin.id,
    action: "saved_view_delete",
    payload: prior ? { id: prior.id, screen: prior.screen, name: prior.name } : { id },
    req,
  });
  return res.status(200).json({ ok: true });
}

async function handler(req: Row, res: Row) {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  if (req.method === "GET") return handleList(req, res);
  if (req.method === "POST") return handleCreate(req, res, admin);
  if (req.method === "PATCH") return handleUpdate(req, res, admin);
  if (req.method === "DELETE") return handleDelete(req, res, admin);
  res.setHeader("Allow", "GET, POST, PATCH, DELETE");
  return res.status(405).json({ error: "Method not allowed" });
}

export default withSentry(handler, { name: "admin-saved-views" });
