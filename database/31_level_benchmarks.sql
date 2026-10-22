-- =====================================================================
-- 31_level_benchmarks.sql | rank_my_store also returns 'level_points':
--   for every level, the LOWEST total season points held by any store
--   at that level (all-India, same season window). The store's level
--   card uses it as the live points benchmark for the next level
--   ("113.32 / 486 points - 373 to go"); when no store holds a level
--   yet, the key is absent and the app estimates the target from the
--   level criteria (cycles x (20 + gate match %)). Levels themselves
--   are still decided only by the gates in _store_level (migration 30).
-- Run once in the Supabase SQL Editor, after 30_level_gates.sql (safe to re-run).
-- =====================================================================

create or replace function public.rank_my_store(p_from timestamptz, p_to timestamptz) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_store uuid := public.my_store_id(); r record;
begin
  if public.app_role() is distinct from 'STORE_USER' or v_store is null then
    raise exception 'You do not have permission to perform this action.' using errcode = '42501'; end if;
  select * into r from public._store_rank(p_from, p_to) where store_id = v_store;
  if not found then return jsonb_build_object('ranked', false); end if;
  return jsonb_build_object('ranked', true, 'store', r.code, 'circle', r.circle, 'points', r.points, 'cycles_done', r.cycles_done, 'cycles_held', r.cycles_held,
    'short', r.short, 'short_transit', r.short_transit, 'short_other', r.short_other, 'counted_short_pct', r.counted_short_pct,
    'match_rate', r.match_rate, 'level', r.level, 'late_count', r.late_count,
    'level_points', (select coalesce(jsonb_object_agg(t.level, t.mp), '{}'::jsonb)
                       from (select level, min(points) as mp from public._store_rank(p_from, p_to) where cycles_done > 0 group by level) t),
    'pan_rank', r.pan_rank, 'pan_total', r.pan_total, 'circle_rank', r.circle_rank, 'circle_total', r.circle_total,
    'cycles', (select coalesce(jsonb_agg(jsonb_build_object('name', c.name, 'status', c.status, 'done', ls.id is not null,
          'short', ls.short_units, 'short_transit', coalesce(tr.q, 0), 'short_other', ls.short_units - coalesce(tr.q, 0),
          'match_rate', case when ls.id is not null and coalesce(ls.expected_units - coalesce(tr.q, 0), 0) > 0 then round(100 * ls.matched_units / (ls.expected_units - coalesce(tr.q, 0)), 2) end,
          'points', case when ls.id is not null then public._rank_points(ls.expected_units - coalesce(tr.q, 0), ls.matched_units) else 0 end) order by c.created_at desc), '[]'::jsonb)
        from public.audit_cycles c
        left join lateral (select x.* from public.audit_sessions x where x.audit_cycle_id = c.id and x.store_id = v_store and x.status = 'LOCKED' order by x.version desc limit 1) ls on true
        left join lateral (select sum(r2.short_qty) as q from public.reconciliation_results r2 where r2.session_id = ls.id and r2.result = 'SHORT' and r2.inventory_status ilike '%transit%') tr on ls.id is not null
       where c.status <> 'DRAFT'
         and c.created_at >= coalesce(p_from, '-infinity'::timestamptz) and c.created_at < coalesce(p_to, 'infinity'::timestamptz)
         and (ls.id is not null or (c.status <> 'ACTIVE' and c.created_at >= (select created_at from public.stores where id = v_store)))));
end $$;

revoke execute on function public.rank_my_store(timestamptz, timestamptz) from public, anon;
grant execute on function public.rank_my_store(timestamptz, timestamptz) to authenticated;
