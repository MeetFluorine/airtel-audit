-- =====================================================================
-- 18_ranking.sql | Store and circle ranking from audit results + participation.
-- Run once in the Supabase SQL Editor (after 17_close_cycle_store_base.sql; safe to re-run).
--
-- POINTS (per audit cycle a store COMPLETED = has a locked audit):
--     20 points for taking part   +   match rate % (0 - 100)   = up to 120 points per cycle
--   A cycle the store did not complete earns 0. A shortage lowers the match rate, so it lowers the points.
--   To change the weights edit ONLY _rank_points() below and re-run this file.
--
-- WHICH CYCLES COUNT for a store ("cycles held"):
--   * every cycle that is closed (COMPLETED / ARCHIVED) and was created after the store was added, plus
--   * any open (ACTIVE) cycle the store has already completed.
--   An open cycle the store has not finished yet is NOT counted against it. Draft cycles never count.
--
-- IN-TRANSIT STOCK: nothing is removed from the audit data. Expected, short, excess and match rate stay exactly as audited.
--   For RANKING ONLY the shortage is split in two: shortage on lines whose Inventory_Status contains "transit"
--   (e.g. "In Transit (S2W)", these devices already left the store) and shortage on every other status.
--   Points use the matches against the OTHER-status shortage only:  match rate = matched / (matched + other-status shortage).
--   The ranking tables show both shortage figures separately. A matched in-transit line still counts as a match.
--   To change the wording that identifies in-transit stock edit the ilike '%transit%' test in _store_rank() and rank_my_store().
--
-- RANK: total points (high first); tie-break = lowest counted shortage % (other-status shortage only); equal on both = same rank.
--   Store rank:  within its circle, and across all active stores in India.
--   Circle rank: average points per active store of the circle (so big and small circles compare fairly).
--
-- WHO SEES WHAT (all through the functions below, nobody reads other stores' data directly):
--   Store user  -> own circle rank + India rank + own cycle-by-cycle points
--   Circle head -> every store in his circle(s) with circle rank + India rank, and his circle(s) rank
--   Admin       -> all stores (India rank), all circles (rank), top store of every circle
-- =====================================================================

create or replace function public._rank_points(p_expected numeric, p_matched numeric) returns numeric
language sql immutable set search_path = '' as $$
  select 20 + coalesce(round(100 * p_matched / nullif(p_expected, 0), 1), 0)
$$;

-- one row per ACTIVE store with totals and ranks (internal: not callable from the app)
-- short = all shortage as audited; short_transit = part of it on in-transit lines; short_other = the rest.
-- counted_short_pct = short_other / (expected - short_transit): the shortage % the ranking uses.
drop function if exists public._store_rank();
drop function if exists public._circle_rank();
create or replace function public._store_rank() returns table(
  store_id uuid, code text, name text, circle_id uuid, circle text, cycles_held int, cycles_done int,
  expected numeric, matched numeric, short numeric, short_transit numeric, short_other numeric, counted_short_pct numeric, points numeric,
  pan_rank int, pan_total int, circle_rank int, circle_total int)
language sql stable security definer set search_path = '' as $$
  with cyc as (
    select s.id as sid, ls.id is not null as done, ls.expected_units as ex, ls.matched_units as ma, ls.short_units as sh, coalesce(tr.q, 0) as trs
      from public.stores s
     cross join public.audit_cycles c
      left join lateral (select x.* from public.audit_sessions x where x.audit_cycle_id = c.id and x.store_id = s.id and x.status = 'LOCKED'
                          order by x.version desc limit 1) ls on true
      left join lateral (select sum(r.short_qty) as q from public.reconciliation_results r
                          where r.session_id = ls.id and r.result = 'SHORT' and r.inventory_status ilike '%transit%') tr on ls.id is not null
     where s.active and c.status <> 'DRAFT'
       and (ls.id is not null or (c.status <> 'ACTIVE' and c.created_at >= s.created_at))
  ), agg as (
    select sid, count(*) as held, count(*) filter (where done) as done_n,
           coalesce(sum(ex) filter (where done), 0) as ex, coalesce(sum(ma) filter (where done), 0) as ma,
           coalesce(sum(sh) filter (where done), 0) as sh, coalesce(sum(trs) filter (where done), 0) as trs,
           coalesce(sum(public._rank_points(ex - trs, ma)) filter (where done), 0) as pts
      from cyc group by sid
  ), base as (
    select s.id, s.code, s.name, c.id as circle_id, c.code as circle, coalesce(a.held, 0) as held, coalesce(a.done_n, 0) as done_n,
           coalesce(a.ex, 0) as ex, coalesce(a.ma, 0) as ma, coalesce(a.sh, 0) as sh, coalesce(a.trs, 0) as trs, coalesce(a.sh, 0) - coalesce(a.trs, 0) as oth,
           case when coalesce(a.ex, 0) - coalesce(a.trs, 0) > 0 then round(100 * (a.sh - a.trs) / (a.ex - a.trs), 2) end as cpct, coalesce(a.pts, 0) as pts
      from public.stores s join public.circles c on c.id = s.circle_id left join agg a on a.sid = s.id
     where s.active
  )
  select id, code, name, circle_id, circle, held::int, done_n::int, ex, ma, sh, trs, oth, cpct, pts,
         (rank() over (order by pts desc, cpct asc nulls last))::int, (count(*) over ())::int,
         (rank() over (partition by circle_id order by pts desc, cpct asc nulls last))::int, (count(*) over (partition by circle_id))::int
    from base
$$;

-- one row per circle, ranked by average points per store (internal)
create or replace function public._circle_rank() returns table(
  circle_id uuid, circle text, stores int, cycles_done int, cycles_held int, avg_points numeric, short numeric, short_transit numeric, short_other numeric,
  counted_short_pct numeric, participation_pct numeric, circle_rank int, circle_total int)
language sql stable security definer set search_path = '' as $$
  with g as (
    select circle_id, circle, count(*)::int as stores, sum(cycles_done)::int as done_n, sum(cycles_held)::int as held,
           round(avg(points), 1) as avg_pts, sum(short) as sh, sum(short_transit) as trs, sum(short_other) as oth,
           case when sum(expected) - sum(short_transit) > 0 then round(100 * sum(short_other) / (sum(expected) - sum(short_transit)), 2) end as cpct,
           case when sum(cycles_held) > 0 then round(100.0 * sum(cycles_done) / sum(cycles_held), 1) end as part_pct
      from public._store_rank() group by circle_id, circle
  )
  select circle_id, circle, stores, done_n, held, avg_pts, sh, trs, oth, cpct, part_pct,
         (rank() over (order by avg_pts desc, cpct asc nulls last))::int, (count(*) over ())::int
    from g
$$;

-- STORE USER: own ranks + points per cycle
create or replace function public.rank_my_store() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_store uuid := public.my_store_id(); r record;
begin
  if public.app_role() is distinct from 'STORE_USER' or v_store is null then
    raise exception 'You do not have permission to perform this action.' using errcode = '42501'; end if;
  select * into r from public._store_rank() where store_id = v_store;
  if not found then return jsonb_build_object('ranked', false); end if;
  return jsonb_build_object('ranked', true, 'store', r.code, 'circle', r.circle, 'points', r.points, 'cycles_done', r.cycles_done, 'cycles_held', r.cycles_held,
    'short', r.short, 'short_transit', r.short_transit, 'short_other', r.short_other, 'counted_short_pct', r.counted_short_pct,
    'pan_rank', r.pan_rank, 'pan_total', r.pan_total, 'circle_rank', r.circle_rank, 'circle_total', r.circle_total,
    'cycles', (select coalesce(jsonb_agg(jsonb_build_object('name', c.name, 'status', c.status, 'done', ls.id is not null,
          'short', ls.short_units, 'short_transit', coalesce(tr.q, 0), 'short_other', ls.short_units - coalesce(tr.q, 0),
          'match_rate', case when ls.id is not null and coalesce(ls.expected_units - coalesce(tr.q, 0), 0) > 0 then round(100 * ls.matched_units / (ls.expected_units - coalesce(tr.q, 0)), 1) end,
          'points', case when ls.id is not null then public._rank_points(ls.expected_units - coalesce(tr.q, 0), ls.matched_units) else 0 end) order by c.created_at desc), '[]'::jsonb)
        from public.audit_cycles c
        left join lateral (select x.* from public.audit_sessions x where x.audit_cycle_id = c.id and x.store_id = v_store and x.status = 'LOCKED' order by x.version desc limit 1) ls on true
        left join lateral (select sum(r2.short_qty) as q from public.reconciliation_results r2 where r2.session_id = ls.id and r2.result = 'SHORT' and r2.inventory_status ilike '%transit%') tr on ls.id is not null
       where c.status <> 'DRAFT' and (ls.id is not null or (c.status <> 'ACTIVE' and c.created_at >= (select created_at from public.stores where id = v_store)))));
end $$;

-- ADMIN / CIRCLE HEAD
create or replace function public.rank_staff() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_role public.user_role := public.app_role();
begin
  if v_role is null or v_role not in ('ADMIN', 'CIRCLE_HEAD') then
    raise exception 'You do not have permission to perform this action.' using errcode = '42501'; end if;
  return jsonb_build_object('role', v_role,
    'stores', (select coalesce(jsonb_agg(jsonb_build_object('id', store_id, 'code', code, 'name', name, 'circle', circle, 'points', points, 'cycles_done', cycles_done, 'cycles_held', cycles_held,
                 'short', short, 'short_transit', short_transit, 'short_other', short_other, 'counted_short_pct', counted_short_pct,
                 'pan_rank', pan_rank, 'pan_total', pan_total, 'circle_rank', circle_rank, 'circle_total', circle_total) order by pan_rank, code), '[]'::jsonb)
                 from public._store_rank() where public.can_manage_store(store_id)),
    'circles', (select coalesce(jsonb_agg(jsonb_build_object('id', circle_id, 'circle', circle, 'stores', stores, 'cycles_done', cycles_done, 'cycles_held', cycles_held, 'avg_points', avg_points,
                 'short', short, 'short_transit', short_transit, 'short_other', short_other, 'counted_short_pct', counted_short_pct, 'participation_pct', participation_pct,
                 'circle_rank', circle_rank, 'circle_total', circle_total,
                 'top_store', (select t.code from public._store_rank() t where t.circle_id = cr.circle_id and t.points > 0 order by t.circle_rank, t.code limit 1),
                 'top_points', (select t.points from public._store_rank() t where t.circle_id = cr.circle_id and t.points > 0 order by t.circle_rank, t.code limit 1)) order by circle_rank, circle), '[]'::jsonb)
                 from public._circle_rank() cr
                where v_role = 'ADMIN' or exists (select 1 from public.circle_head_assignments a where a.user_id = auth.uid() and a.circle_id = cr.circle_id)));
end $$;

revoke execute on function public._rank_points(numeric, numeric), public._store_rank(), public._circle_rank() from public, anon, authenticated;
revoke execute on function public.rank_my_store(), public.rank_staff() from public, anon;
grant execute on function public.rank_my_store(), public.rank_staff() to authenticated;
