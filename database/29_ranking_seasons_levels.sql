-- =====================================================================
-- 29_ranking_seasons_levels.sql
--   Ranking now runs in SEASONS (3-month calendar quarters: Jan-Mar,
--   Apr-Jun, Jul-Sep, Oct-Dec). The app sends the season window
--   (p_from / p_to) and only cycles CREATED inside it count - points,
--   ranks and levels are all per season, so every season is a fresh
--   race and a finished season's numbers never change again.
--
--   LEVELS (per store, per season) - points alone can be farmed by
--   just taking part, so every level also has quality gates:
--     completion = cycles_done / cycles_held (this season)
--     match      = matched / (expected - in-transit shortage)  [ranking match rate]
--     shortage   = genuine (other-status) shortage % of expected [counted_short_pct]
--     Champion : completion 100% , match >= 98% , shortage <= 1%   , no late submission
--     Diamond  : completion 100% , match >= 97% , shortage <= 1.5%
--     Platinum : completion >= 90%, match >= 95% , shortage <= 2.5%
--     Gold     : completion >= 80%, match >= 93% , shortage <= 3.5%
--     Silver   : completion >= 65%, match >= 90% , shortage <= 5%
--     Bronze   : completion >= 50%, match >= 85% , shortage <= 8%
--     otherwise: Unranked
--   "Late" = a completed audit whose submitted_at is after the
--   cycle's deadline (cycles without a deadline count as on time).
--   To change the gates edit ONLY _store_level() below and re-run.
--
--   rank_my_store(from,to) / rank_staff(from,to) replace the no-arg
--   versions from migration 18 and now also return level, match_rate
--   and late_count. Points formula is UNCHANGED (migration 18).
-- Run once in the Supabase SQL Editor, after 28_reopen_cycle.sql (safe to re-run).
-- =====================================================================

drop function if exists public.rank_my_store();
drop function if exists public.rank_staff();
drop function if exists public._circle_rank();
drop function if exists public._store_rank();

-- ---------- level gates (single place to tune) ----------
create or replace function public._store_level(p_done int, p_held int, p_match numeric, p_short numeric, p_late int) returns text
language sql immutable set search_path = '' as $$
  select case
    when coalesce(p_held, 0) <= 0 or coalesce(p_done, 0) <= 0 or p_match is null then 'Unranked'
    when p_done >= p_held and p_match >= 98 and p_short <= 1 and coalesce(p_late, 0) = 0 then 'Champion'
    when p_done >= p_held and p_match >= 97 and p_short <= 1.5 then 'Diamond'
    when p_done * 10 >= p_held * 9 and p_match >= 95 and p_short <= 2.5 then 'Platinum'
    when p_done * 5 >= p_held * 4 and p_match >= 93 and p_short <= 3.5 then 'Gold'
    when p_done * 20 >= p_held * 13 and p_match >= 90 and p_short <= 5 then 'Silver'
    when p_done * 2 >= p_held and p_match >= 85 and p_short <= 8 then 'Bronze'
    else 'Unranked' end $$;

-- ---------- windowed store ranking (migration 18 + season window + level) ----------
create or replace function public._store_rank(p_from timestamptz, p_to timestamptz) returns table(
  store_id uuid, code text, name text, circle_id uuid, circle text, cycles_held int, cycles_done int,
  expected numeric, matched numeric, short numeric, short_transit numeric, short_other numeric, counted_short_pct numeric, points numeric,
  match_rate numeric, late_count int, level text,
  pan_rank int, pan_total int, circle_rank int, circle_total int)
language sql stable security definer set search_path = '' as $$
  with cyc as (
    select s.id as sid, ls.id is not null as done, ls.expected_units as ex, ls.matched_units as ma, ls.short_units as sh, coalesce(tr.q, 0) as trs,
           (ls.id is not null and (c.deadline_at is null or ls.submitted_at is null or ls.submitted_at <= c.deadline_at)) as ontime
      from public.stores s
     cross join public.audit_cycles c
      left join lateral (select x.* from public.audit_sessions x where x.audit_cycle_id = c.id and x.store_id = s.id and x.status = 'LOCKED'
                          order by x.version desc limit 1) ls on true
      left join lateral (select sum(r.short_qty) as q from public.reconciliation_results r
                          where r.session_id = ls.id and r.result = 'SHORT' and r.inventory_status ilike '%transit%') tr on ls.id is not null
     where s.active and c.status <> 'DRAFT'
       and c.created_at >= coalesce(p_from, '-infinity'::timestamptz) and c.created_at < coalesce(p_to, 'infinity'::timestamptz)
       and (ls.id is not null or (c.status <> 'ACTIVE' and c.created_at >= s.created_at))
  ), agg as (
    select sid, count(*) as held, count(*) filter (where done) as done_n,
           coalesce(sum(ex) filter (where done), 0) as ex, coalesce(sum(ma) filter (where done), 0) as ma,
           coalesce(sum(sh) filter (where done), 0) as sh, coalesce(sum(trs) filter (where done), 0) as trs,
           count(*) filter (where done and not ontime) as late_n,
           coalesce(sum(public._rank_points(ex - trs, ma)) filter (where done), 0) as pts
      from cyc group by sid
  ), base as (
    select s.id, s.code, s.name, c.id as circle_id, c.code as circle, coalesce(a.held, 0) as held, coalesce(a.done_n, 0) as done_n,
           coalesce(a.ex, 0) as ex, coalesce(a.ma, 0) as ma, coalesce(a.sh, 0) as sh, coalesce(a.trs, 0) as trs, coalesce(a.sh, 0) - coalesce(a.trs, 0) as oth,
           case when coalesce(a.ex, 0) > 0 then round(100 * (a.sh - a.trs) / a.ex, 4) end as cpct, coalesce(a.pts, 0) as pts,
           coalesce(a.late_n, 0) as late_n,
           case when coalesce(a.ex, 0) - coalesce(a.trs, 0) > 0 then round(100 * a.ma / (a.ex - a.trs), 4) end as mrate
      from public.stores s join public.circles c on c.id = s.circle_id left join agg a on a.sid = s.id
     where s.active
  )
  select id, code, name, circle_id, circle, held::int, done_n::int, ex, ma, sh, trs, oth, cpct, pts, mrate, late_n::int,
         public._store_level(done_n::int, held::int, mrate, cpct, late_n::int),
         (dense_rank() over (order by pts desc, cpct asc nulls last))::int, (count(*) over ())::int,
         (dense_rank() over (partition by circle_id order by pts desc, cpct asc nulls last))::int, (count(*) over (partition by circle_id))::int
    from base
$$;

-- ---------- windowed circle ranking (unchanged shape) ----------
create or replace function public._circle_rank(p_from timestamptz, p_to timestamptz) returns table(
  circle_id uuid, circle text, stores int, cycles_done int, cycles_held int, avg_points numeric,
  short numeric, short_transit numeric, short_other numeric,
  counted_short_pct numeric, participation_pct numeric, circle_rank int, circle_total int)
language sql stable security definer set search_path = '' as $$
  with g as (
    select circle_id, circle, count(*)::int as stores, sum(cycles_done)::int as done_n, sum(cycles_held)::int as held,
           round(avg(points), 4) as avg_pts, sum(short) as sh, sum(short_transit) as trs, sum(short_other) as oth,
           case when sum(expected) > 0 then round(100 * sum(short_other) / sum(expected), 4) end as cpct,
           case when sum(cycles_held) > 0 then round(100.0 * sum(cycles_done) / sum(cycles_held), 1) end as part_pct
      from public._store_rank(p_from, p_to) group by circle_id, circle
  )
  select circle_id, circle, stores, done_n, held, avg_pts, sh, trs, oth, cpct, part_pct,
         (dense_rank() over (order by avg_pts desc, cpct asc nulls last))::int, (count(*) over ())::int
    from g
$$;

-- ---------- STORE USER: own ranks + level + points per cycle (season window) ----------
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

-- ---------- ADMIN / CIRCLE HEAD (season window) ----------
create or replace function public.rank_staff(p_from timestamptz, p_to timestamptz) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_role public.user_role := public.app_role();
begin
  if v_role is null or v_role not in ('ADMIN', 'CIRCLE_HEAD') then
    raise exception 'You do not have permission to perform this action.' using errcode = '42501'; end if;
  return jsonb_build_object('role', v_role,
    'stores', (select coalesce(jsonb_agg(jsonb_build_object('id', store_id, 'code', code, 'name', name, 'circle', circle, 'points', points, 'cycles_done', cycles_done, 'cycles_held', cycles_held,
                 'short', short, 'short_transit', short_transit, 'short_other', short_other, 'counted_short_pct', counted_short_pct,
                 'match_rate', match_rate, 'level', level, 'late_count', late_count,
                 'pan_rank', pan_rank, 'pan_total', pan_total, 'circle_rank', circle_rank, 'circle_total', circle_total) order by pan_rank, code), '[]'::jsonb)
                 from public._store_rank(p_from, p_to) where public.can_manage_store(store_id)),
    'circles', (select coalesce(jsonb_agg(jsonb_build_object('id', circle_id, 'circle', circle, 'stores', stores, 'cycles_done', cycles_done, 'cycles_held', cycles_held, 'avg_points', avg_points,
                 'short', short, 'short_transit', short_transit, 'short_other', short_other, 'counted_short_pct', counted_short_pct, 'participation_pct', participation_pct,
                 'circle_rank', circle_rank, 'circle_total', circle_total,
                 'top_store', (select t.code from public._store_rank(p_from, p_to) t where t.circle_id = cr.circle_id and t.points > 0 order by t.circle_rank, t.code limit 1),
                 'top_points', (select t.points from public._store_rank(p_from, p_to) t where t.circle_id = cr.circle_id and t.points > 0 order by t.circle_rank, t.code limit 1)) order by circle_rank, circle), '[]'::jsonb)
                 from public._circle_rank(p_from, p_to) cr
                where v_role = 'ADMIN' or exists (select 1 from public.circle_head_assignments a where a.user_id = auth.uid() and a.circle_id = cr.circle_id)));
end $$;

revoke execute on function public._store_level(int, int, numeric, numeric, int), public._store_rank(timestamptz, timestamptz), public._circle_rank(timestamptz, timestamptz) from public, anon, authenticated;
revoke execute on function public.rank_my_store(timestamptz, timestamptz), public.rank_staff(timestamptz, timestamptz) from public, anon;
grant execute on function public.rank_my_store(timestamptz, timestamptz), public.rank_staff(timestamptz, timestamptz) to authenticated;
