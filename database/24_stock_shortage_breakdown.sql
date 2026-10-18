-- =====================================================================
-- 24_stock_shortage_breakdown.sql
--   Dashboard "Stock Condition" card: split the Shortage total into
--     * short_transit : shortage units whose inventory_status mentions transit
--     * ser_short     : shortage units of serialized items (not in transit)
--     * non_short     : shortage units of non-serialized items (not in transit)
--   The three add up to the total short units the dashboard already shows.
--
--   dash_shortage_breakdown(p_cycle, p_circles): one server call that aggregates
--   reconciliation_results over exactly the same completed sessions the
--   dashboard sums (latest IN_PROGRESS/LOCKED session per store, LOCKED only),
--   scoped to the caller (ADMIN sees all stores, Circle Head only their own).
--   p_circles is optional: pass circle codes to match the dashboard's circle filter.
--
-- Run once in the Supabase SQL Editor (after 20; safe to re-run).
-- =====================================================================

create or replace function public.dash_shortage_breakdown(p_cycle uuid, p_circles text[] default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v jsonb;
begin
  if public.app_role() not in ('ADMIN','CIRCLE_HEAD') then
    raise exception 'You do not have permission to perform this action.' using errcode = '42501';
  end if;
  with latest as (
    select distinct on (s.store_id) s.id, s.status
      from public.audit_sessions s
     where s.audit_cycle_id = p_cycle
       and s.status in ('IN_PROGRESS','LOCKED')
       and s.store_id in (select store_id from public._scope())
       and (p_circles is null or exists (
             select 1 from public.stores st
               join public.circles c on c.id = st.circle_id
              where st.id = s.store_id and c.code = any(p_circles)))
     order by s.store_id, s.version desc
  )
  select jsonb_build_object(
    'short_transit', coalesce(sum(r.short_qty) filter (where r.result = 'SHORT' and r.inventory_status ilike '%transit%'), 0),
    'ser_short',     coalesce(sum(r.short_qty) filter (where r.result = 'SHORT'
                        and coalesce(r.is_serialized, false)
                        and not (coalesce(r.inventory_status, '') ilike '%transit%')), 0),
    'non_short',     coalesce(sum(r.short_qty) filter (where r.result = 'SHORT'
                        and not coalesce(r.is_serialized, false)
                        and not (coalesce(r.inventory_status, '') ilike '%transit%')), 0)
  ) into v
  from public.reconciliation_results r
  join latest l on l.id = r.session_id and l.status = 'LOCKED';
  return v;
end $$;

revoke execute on function public.dash_shortage_breakdown(uuid, text[]) from public, anon;
grant execute on function public.dash_shortage_breakdown(uuid, text[]) to authenticated;
