-- Migration 046: admin revenue overview RPC.
--
-- Surfaces the Revenue page on the new admin dashboard. Returns a
-- single JSON snapshot:
--   - active_subs            count of paid sub statuses + trialing-with-pm
--   - trialing_subs           trialing without payment method (abandoned)
--   - comp_subs               comp_granted accounts
--   - cancelled_30d           subs cancelled in the last 30 days
--   - mrr_estimate_cents      active_subs * monthly_price (rough MRR; we
--                             only sell one price right now so this is
--                             accurate; if/when annual lands, branch by
--                             stripe_price_id)
--   - revenue_30d_cents       sum(amount_cents) from stripe_invoices
--                             paid in the last 30 days
--   - revenue_total_cents     sum(amount_cents) from stripe_invoices all-time
--   - currency                'mxn' (we're MX-only)
--   - as_of                   timestamp the snapshot was taken
--
-- Gated by is_admin(); a non-admin caller gets a thrown exception.
-- The active-sub heuristic mirrors useSubscription.js::isPro
-- (PAID_STATUSES = ['active', 'past_due'] OR trialing+default_payment_method
-- OR comp_granted). We split comp out of the count for transparency
-- (admin wants to know how many comps are giving up paid revenue).

create or replace function admin_revenue_overview()
returns jsonb
language plpgsql
security definer
as $$
declare
  result jsonb;
  monthly_price_cents int := 29900; -- $299 MXN tax-inclusive
begin
  if not is_admin() then
    raise exception 'Forbidden';
  end if;

  with sub_stats as (
    select
      count(*) filter (
        where comp_granted is not true
        and (status in ('active','past_due')
             or (status = 'trialing' and default_payment_method is not null))
      ) as active_subs,
      count(*) filter (
        where comp_granted is not true
        and status = 'trialing'
        and default_payment_method is null
      ) as trialing_subs,
      count(*) filter (where comp_granted is true) as comp_subs,
      count(*) filter (
        where status = 'canceled'
        and updated_at > now() - interval '30 days'
      ) as cancelled_30d
    from user_subscriptions
  ),
  inv_stats as (
    select
      coalesce(sum(amount_cents) filter (
        where paid_at is not null and paid_at > now() - interval '30 days'
      ), 0) as revenue_30d_cents,
      coalesce(sum(amount_cents) filter (
        where paid_at is not null
      ), 0) as revenue_total_cents
    from stripe_invoices
  )
  select jsonb_build_object(
    'active_subs',           s.active_subs,
    'trialing_subs',         s.trialing_subs,
    'comp_subs',             s.comp_subs,
    'cancelled_30d',         s.cancelled_30d,
    'mrr_estimate_cents',    s.active_subs * monthly_price_cents,
    'revenue_30d_cents',     i.revenue_30d_cents,
    'revenue_total_cents',   i.revenue_total_cents,
    'currency',              'mxn',
    'as_of',                 now()
  ) into result
  from sub_stats s, inv_stats i;

  return result;
end;
$$;

grant execute on function admin_revenue_overview() to authenticated;
