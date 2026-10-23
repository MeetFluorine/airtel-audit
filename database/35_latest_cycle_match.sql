-- =====================================================================
-- 35_latest_cycle_match.sql | Ranking match rate now reads the LATEST
-- completed cycle too - the same snapshot the shortage columns already
-- use since migration 33.
--   Every cycle is audited against a FRESH base-data upload, so a
--   store's current match position is its latest audit: 0% genuine
--   shortage in the latest cycle means a 100% match rate for ranking,
--   2% genuine shortage means 98%. Before this change the match rate
--   was a season sum, so a clean latest cycle still showed an old
--   cycle's shortage in the rate (e.g. a store at 0% short showing
--   97.67% match).
--   The snapshot CTE gains the latest cycle's matched units (s_ma) and
--   the match rate is (s_ma + accepted) / (s_ex - s_transit) of that
--   cycle. _store_level receives this rate, so the level match gate
--   reads the latest cycle too, consistent with the shortage gate.
--   Points, completion and late counts stay season-long, unchanged.
-- Run once in the Supabase SQL Editor, after 33 (safe to re-run).
-- =====================================================================

create or replace function public._store_rank(p_from timestamptz, p_to timestamptz) returns table(
  store_id uuid, code text, name text, circle_id uuid, circle text, cycles_held int, cycles_done int,
  expected numeric, matched numeric, short numeric, short_transit numeric, short_other numeric, short_explained numeric, counted_short_pct numeric, points numeric,
  match_rate numeric, late_count int, level text,
  pan_rank int, pan_total int, circle_rank int, circle_total int)
language sql stable security definer set search_path = '' as $$
  with cyc as (
    select s.id as sid, c.created_at as c_created, ls.id is not null as done, ls.expected_units as ex, ls.matched_units as ma, ls.short_units as sh, coalesce(tr.q, 0) as trs,
           coalesce(rv.q, 0) as acc,
           (ls.id is not null and (c.deadline_at is null or ls.submitted_at is null or ls.submitted_at <= c.deadline_at)) as ontime
      from public.stores s
     cross join public.audit_cycles c
      left join lateral (select x.* from public.audit_sessions x where x.audit_cycle_id = c.id and x.store_id = s.id and x.status = 'LOCKED'
                          order by x.version desc limit 1) ls on true
      left join lateral (select sum(r.short_qty) as q from public.reconciliation_results r
                          where r.session_id = ls.id and r.result = 'SHORT' and r.inventory_status ilike '%transit%') tr on ls.id is not null
      left join lateral (select coalesce(sum(least(rr.accepted_qty, r.short_qty)), 0) as q
                           from public.reconciliation_results r
                           join public.result_remarks rr on rr.store_id = s.id and rr.audit_cycle_id = c.id
                             and rr.item_code = r.item_code and rr.inventory_status = coalesce(r.inventory_status, '')
                             and rr.item_quality = coalesce(r.item_quality, '') and rr.item_sno = coalesce(r.item_sno, '')
                          where r.session_id = ls.id and r.result = 'SHORT'
                            and not (coalesce(r.inventory_status, '') ilike '%transit%')
                            and rr.status = 'REVIEWED' and coalesce(rr.accepted_qty, 0) > 0) rv on ls.id is not null
     where s.active and c.status <> 'DRAFT'
       and c.created_at >= coalesce(p_from, '-infinity'::timestamptz) and c.created_at < coalesce(p_to, 'infinity'::timestamptz)
       and (ls.id is not null or (c.status <> 'ACTIVE' and c.created_at >= s.created_at))
  ), snap as (   -- the store's latest completed cycle in the window: the season's shortage position
    select distinct on (sid) sid, ex as s_ex, ma as s_ma, sh as s_sh, trs as s_trs, acc as s_acc
      from cyc where done order by sid, c_created desc
  ), agg as (
    select sid, count(*) as held, count(*) filter (where done) as done_n,
           coalesce(sum(ex) filter (where done), 0) as ex, coalesce(sum(ma) filter (where done), 0) as ma,
           coalesce(sum(sh) filter (where done), 0) as sh, coalesce(sum(trs) filter (where done), 0) as trs,
           coalesce(sum(acc) filter (where done), 0) as acc,
           count(*) filter (where done and not ontime) as late_n,
           coalesce(sum(public._rank_points(ex - trs, ma + acc)) filter (where done), 0) as pts
      from cyc group by sid
  ), base as (
    select s.id, s.code, s.name, c.id as circle_id, c.code as circle, coalesce(a.held, 0) as held, coalesce(a.done_n, 0) as done_n,
           coalesce(sn.s_ex, 0) as ex, coalesce(a.ma, 0) as ma, coalesce(sn.s_sh, 0) as sh, coalesce(sn.s_trs, 0) as trs, coalesce(sn.s_acc, 0) as acc,
           greatest(coalesce(sn.s_sh, 0) - coalesce(sn.s_trs, 0) - coalesce(sn.s_acc, 0), 0) as oth,
           case when coalesce(sn.s_ex, 0) > 0 then round(100 * greatest(coalesce(sn.s_sh, 0) - coalesce(sn.s_trs, 0) - coalesce(sn.s_acc, 0), 0) / sn.s_ex, 4) end as cpct,
           coalesce(a.pts, 0) as pts,
           coalesce(a.late_n, 0) as late_n,
           case when coalesce(sn.s_ex, 0) - coalesce(sn.s_trs, 0) > 0 then round(100 * (coalesce(sn.s_ma, 0) + sn.s_acc) / (sn.s_ex - sn.s_trs), 4) end as mrate
      from public.stores s join public.circles c on c.id = s.circle_id
      left join agg a on a.sid = s.id left join snap sn on sn.sid = s.id
     where s.active
  )
  select id, code, name, circle_id, circle, held::int, done_n::int, ex, ma, sh, trs, oth, acc, cpct, pts, mrate, late_n::int,
         public._store_level(done_n::int, held::int, mrate, cpct, late_n::int),
         (dense_rank() over (order by pts desc, cpct asc nulls last))::int, (count(*) over ())::int,
         (dense_rank() over (partition by circle_id order by pts desc, cpct asc nulls last))::int, (count(*) over (partition by circle_id))::int
    from base
$$;

revoke execute on function public._store_rank(timestamptz, timestamptz) from public, anon, authenticated;
