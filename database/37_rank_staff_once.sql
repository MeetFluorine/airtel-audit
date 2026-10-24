-- =====================================================================
-- 37_rank_staff_once.sql | Ranking page speed (dashboard P0).
--
--   Problem: rank_staff() evaluated _store_rank() once for the store
--   list, once inside _circle_rank(), and then TWICE MORE PER CIRCLE
--   (top_store + top_points subqueries) — 26 full evaluations for 12
--   circles, which is why the Ranking page took ~25-30s while every
--   other page took ~2s.
--
--   Fix: _store_rank() is now evaluated EXACTLY ONCE into a MATERIALIZED
--   CTE, and the store list, the circle aggregates (same expressions as
--   _circle_rank) and the per-circle top store / top points are all
--   derived from that one result. Output shape, ordering and values are
--   IDENTICAL to the previous version — points, ranks, levels, bonus
--   counts and circle ranks do not change, only the work does.
--
--   Why the circle aggregates are still identical for a Circle Head:
--   can_manage_store() for a Circle Head means "stores of my assigned
--   circles", so for every circle that survives the role filter the CTE
--   already holds all of that circle's stores. For an Admin the CTE
--   holds every store, exactly like _circle_rank did.
--
--   Bonus counts (oneshot / cleansweep) are read through to_jsonb() so
--   this function works whether or not migration 36 has run: before 36
--   the counts come back null (the app hides the chips, as today).
--
--   ORDERING NOTE: migration 36 redefines rank_staff() too. Run 36
--   first, then this file. If 36 is ever re-run after this file, re-run
--   this file again — otherwise the slow version comes back.
-- Run once in the Supabase SQL editor (safe to re-run).
-- =====================================================================

create or replace function public.rank_staff(p_from timestamptz, p_to timestamptz) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_role public.user_role := public.app_role();
        v_out jsonb;
begin
  if v_role is null or v_role not in ('ADMIN', 'CIRCLE_HEAD') then
    raise exception 'You do not have permission to perform this action.' using errcode = '42501'; end if;
  with r as materialized (
    select * from public._store_rank(p_from, p_to) where public.can_manage_store(store_id)
  ),
  g as (
    select circle_id, circle, count(*)::int as stores, sum(cycles_done)::int as done_n, sum(cycles_held)::int as held,
           round(avg(points), 4) as avg_pts, sum(short) as sh, sum(short_transit) as trs, sum(short_other) as oth,
           case when sum(expected) > 0 then round(100 * sum(short_other) / sum(expected), 4) end as cpct,
           case when sum(cycles_held) > 0 then round(100.0 * sum(cycles_done) / sum(cycles_held), 1) end as part_pct
      from r group by circle_id, circle
  ),
  cr as (
    select circle_id, circle, stores, done_n, held, avg_pts, sh, trs, oth, cpct, part_pct,
           (dense_rank() over (order by avg_pts desc, cpct asc nulls last))::int as circle_rank, (count(*) over ())::int as circle_total
      from g
  )
  select jsonb_build_object('role', v_role,
    'stores', (select coalesce(jsonb_agg(jsonb_build_object('id', store_id, 'code', code, 'name', name, 'circle', circle, 'points', points, 'cycles_done', cycles_done, 'cycles_held', cycles_held,
                 'short', short, 'short_transit', short_transit, 'short_other', short_other, 'counted_short_pct', counted_short_pct,
                 'match_rate', match_rate, 'level', level, 'late_count', late_count,
                 'oneshot', (to_jsonb(r2) ->> 'oneshot')::int, 'cleansweep', (to_jsonb(r2) ->> 'cleansweep')::int,
                 'pan_rank', pan_rank, 'pan_total', pan_total, 'circle_rank', circle_rank, 'circle_total', circle_total) order by pan_rank, code), '[]'::jsonb)
                 from r r2),
    'circles', (select coalesce(jsonb_agg(jsonb_build_object('id', circle_id, 'circle', circle, 'stores', stores, 'cycles_done', done_n, 'cycles_held', held, 'avg_points', avg_pts,
                 'short', sh, 'short_transit', trs, 'short_other', oth, 'counted_short_pct', cpct, 'participation_pct', part_pct,
                 'circle_rank', circle_rank, 'circle_total', circle_total,
                 'top_store', (select t.code from r t where t.circle_id = cr.circle_id and t.points > 0 order by t.circle_rank, t.code limit 1),
                 'top_points', (select t.points from r t where t.circle_id = cr.circle_id and t.points > 0 order by t.circle_rank, t.code limit 1)) order by circle_rank, circle), '[]'::jsonb)
                 from cr
                where v_role = 'ADMIN' or exists (select 1 from public.circle_head_assignments a where a.user_id = auth.uid() and a.circle_id = cr.circle_id)))
    into v_out;
  return v_out;
end $$;

revoke execute on function public.rank_staff(timestamptz, timestamptz) from public, anon;
grant execute on function public.rank_staff(timestamptz, timestamptz) to authenticated;
