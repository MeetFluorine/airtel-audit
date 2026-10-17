-- =====================================================================
-- 19_result_filter_values.sql | Feeds the click-to-select column filters on the result page.
-- Run once in the Supabase SQL Editor (after 18; safe to re-run). Until it is run, the filter popups on
-- Item_Code / Inventory_Status / UoM / Quality fall back to a plain "contains" box; everything else works.
-- SECURITY INVOKER: row-level security decides what each user can see, exactly like result_summary().
-- =====================================================================
create or replace function public.result_filter_values(p_session uuid) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'item_code',        (select coalesce(jsonb_agg(v order by v), '[]'::jsonb) from (select distinct item_code as v from public.reconciliation_results where session_id = p_session order by 1 limit 1000) x),
    'inventory_status', (select coalesce(jsonb_agg(v order by v), '[]'::jsonb) from (select distinct coalesce(inventory_status, '') as v from public.reconciliation_results where session_id = p_session order by 1 limit 1000) x),
    'item_uom',         (select coalesce(jsonb_agg(v order by v), '[]'::jsonb) from (select distinct coalesce(item_uom, '') as v from public.reconciliation_results where session_id = p_session order by 1 limit 1000) x),
    'item_quality',     (select coalesce(jsonb_agg(v order by v), '[]'::jsonb) from (select distinct coalesce(item_quality, '') as v from public.reconciliation_results where session_id = p_session order by 1 limit 1000) x))
$$;
revoke execute on function public.result_filter_values(uuid) from public, anon;
grant execute on function public.result_filter_values(uuid) to authenticated;
