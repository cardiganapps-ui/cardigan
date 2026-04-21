-- Resubscription support + cron diagnostics helper.
--
-- Background
-- ----------
-- Service workers can't access the Supabase session token, so the SW's
-- `pushsubscriptionchange` handler can't authenticate with a JWT when it
-- asks the server to replace a rotated subscription. To close the silent-
-- 401 hole, we bind each subscription to an opaque one-shot token. The
-- SW keeps the token in IndexedDB; the unauthenticated resubscribe
-- endpoint matches on (endpoint, resub_token) to authorize the swap and
-- then rotates the token.

alter table push_subscriptions
  add column if not exists resub_token text;

-- Partial index — tokens are nullable (older rows + post-swap) and a
-- full index on a mostly-null column is wasted space.
create index if not exists idx_push_subscriptions_resub_token
  on push_subscriptions(resub_token)
  where resub_token is not null;

-- --------------------------------------------------------------------
-- diag_cron_job_state — read-only helper surfaced to /api/push-diagnose.
-- supabase-js can't query the cron.* schema directly (PostgREST only
-- exposes the public schema by default), so we wrap the two queries we
-- need in a SECURITY DEFINER function and grant it to service_role.
-- --------------------------------------------------------------------

create or replace function diag_cron_job_state()
returns jsonb
language sql
security definer
set search_path = cron, pg_catalog
as $$
  select jsonb_build_object(
    'job', (
      select jsonb_build_object(
        'jobid', j.jobid,
        'jobname', j.jobname,
        'schedule', j.schedule,
        'active', j.active,
        'command_preview', substring(j.command from 1 for 400)
      )
      from cron.job j
      where j.jobname = 'send-session-reminders'
    ),
    'recentRuns', (
      select jsonb_agg(row_to_json(r) order by r.start_time desc)
      from (
        select runid, status, return_message, start_time, end_time
        from cron.job_run_details
        where jobid = (select jobid from cron.job where jobname = 'send-session-reminders')
        order by start_time desc
        limit 20
      ) r
    )
  );
$$;

revoke all on function diag_cron_job_state() from public;
grant execute on function diag_cron_job_state() to service_role;
