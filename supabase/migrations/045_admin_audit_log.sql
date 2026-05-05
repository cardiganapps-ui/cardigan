-- Migration 045: admin audit log.
--
-- Every admin action writes an immutable row here. Compliance trail
-- for impersonation starts ("view_as"), block / unblock, comp grant,
-- profession edits, account deletion, encryption recovery, and
-- discount-code lifecycle.
--
-- Wiring: api/_admin.js::logAuditEvent(svc, {...}) is called from
-- every /api/admin-* endpoint AFTER the primary action succeeds.
-- Logging failures are swallowed (we never block an admin action
-- because the audit table is briefly unreachable). Client-initiated
-- events (view_as start) post via the new /api/admin-audit endpoint.
--
-- Read access: admin-only via is_admin() RLS. No INSERT policy —
-- writes happen exclusively via the service-role client.

create table if not exists admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  -- The admin who performed the action. References auth.users(id)
  -- but kept as plain uuid (no FK) so we can still read history if
  -- the admin user is ever deleted.
  actor_id uuid not null,
  -- The user the action targeted (nullable: e.g. create_code has no target).
  target_user_id uuid,
  -- Action type. Convention: snake_case verb. Common values:
  --   block_user, unblock_user, delete_user, update_profession,
  --   grant_comp, revoke_comp, create_code, toggle_code,
  --   recover_encryption, view_as
  action text not null,
  -- Action-specific structured detail (e.g. { from: "psychologist",
  -- to: "nutritionist" } for update_profession). Strictly metadata —
  -- never includes patient PII.
  payload jsonb,
  -- IP + user agent of the admin's browser, sniffed from request
  -- headers. Both nullable (best-effort).
  ip text,
  ua text,
  created_at timestamptz not null default now()
);

create index if not exists admin_audit_log_created_idx
  on admin_audit_log(created_at desc);
create index if not exists admin_audit_log_target_idx
  on admin_audit_log(target_user_id, created_at desc);
create index if not exists admin_audit_log_action_idx
  on admin_audit_log(action, created_at desc);

alter table admin_audit_log enable row level security;

drop policy if exists "Admin reads audit log" on admin_audit_log;
create policy "Admin reads audit log"
  on admin_audit_log for select
  using (is_admin());

-- No INSERT policy. Writes go through service-role client only.
