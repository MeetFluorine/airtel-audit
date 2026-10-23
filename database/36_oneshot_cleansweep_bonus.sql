-- =====================================================================
-- 36_oneshot_cleansweep_bonus.sql | Two new per-cycle BONUS awards in
-- the ranking points, decided on each cycle's final state:
--
--   ONE-SHOT   +10 : the store's audit was submitted with ZERO genuine
--                    shortage (in-transit excluded, as always) and the
--                    audit was NEVER reopened by an admin.
--   CLEAN SWEEP +5 : the audit DID have genuine shortage, the store
--                    explained all of it with shortage remarks and
--                    management accepted ALL of them, so the cycle
--                    closed at zero genuine shortage. Never reopened.
--   Anything else (partial acceptance, rejected remarks, no remarks,
--   or any reopen) earns no bonus. A cycle earns at most ONE bonus,
--   so a cycle can now give 20 + match (<=100) + 10 = 130 points max.
--
--   Points stay season-cumulative and recalculate live: a Clean Sweep
--   lands the moment the last pending remark is accepted. Levels are
--   NOT changed - the gates in _store_level stay exactly as they are;
--   the bonuses only move points (and therefore ranks).
--   _store_rank also returns the season counts (oneshot / cleansweep)
--   and rank_my_store reports each cycle's bonus, so the app can show
--   the streak icons: how many times a store earned each award.
-- Run once in the Supabase SQL Editor, after 35 (safe to re-run).
-- =====================================================================

drop function if exists public._store_rank(timestamptz, timestamptz);

create or replace function public._store_rank(p_from timestamptz, p_to timestamptz) returns table(
  store_id uuid, code text, name text, circle_id uuid, circle text, cycles_held int, cycles_done int,
  expected numeric, matched numeric, short numeric, short_transit numeric, short_other numeric, short_explained numeric, counted_short_pct numeric, points numeric,
  match_rate numeric, late_count int, level text,
  pan_rank int, pan_total int, circle_rank int, circle_total int, oneshot int, cleansweep int)
language sql stable security definer set search_path = '' as $$
  with cyc as (
    select s.id as sid, c.created_at as c_created, ls.id is not null as done, ls.expected_units as ex, ls.matched_units as ma, ls.short_units as sh, coalesce(tr.q, 0) as trs,
           coalesce(rv.q, 0) as acc,
           (ls.id is not null and (c.deadline_at is null or ls.submitted_at is null or ls.submitted_at <= c.deadline_at)) as ontime,
           exists(select 1 from public.audit_sessions rx where rx.audit_cycle_id = c.id and rx.store_id = s.id and rx.reopened_at is not null) as reop
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
  ), cycb as (   -- the cycle's bonus award: 10 = One-Shot, 5 = Clean Sweep, 0 = neither
    select *, case when not done or reop then 0
                   when coalesce(sh, 0) - trs <= 0 then 10
                   when acc >= coalesce(sh, 0) - trs then 5
                   else 0 end as bon
      from cyc
  ), snap as (   -- the store's latest completed cycle in the window: the season's shortage position
    select distinct on (sid) sid, ex as s_ex, ma as s_ma, sh as s_sh, trs as s_trs, acc as s_acc
      from cycb where done order by sid, c_created desc
  ), agg as (
    select sid, count(*) as held, count(*) filter (where done) as done_n,
           coalesce(sum(ex) filter (where done), 0) as ex, coalesce(sum(ma) filter (where done), 0) as ma,
           coalesce(sum(sh) filter (where done), 0) as sh, coalesce(sum(trs) filter (where done), 0) as trs,
           coalesce(sum(acc) filter (where done), 0) as acc,
           count(*) filter (where done and not ontime) as late_n,
           coalesce(sum(public._rank_points(ex - trs, ma + acc) + bon) filter (where done), 0) as pts,
           count(*) filter (where done and bon = 10) as os_n,
           count(*) filter (where done and bon = 5) as cs_n
      from cycb group by sid
  ), base as (
    select s.id, s.code, s.name, c.id as circle_id, c.code as circle, coalesce(a.held, 0) as held, coalesce(a.done_n, 0) as done_n,
           coalesce(sn.s_ex, 0) as ex, coalesce(a.ma, 0) as ma, coalesce(sn.s_sh, 0) as sh, coalesce(sn.s_trs, 0) as trs, coalesce(sn.s_acc, 0) as acc,
           greatest(coalesce(sn.s_sh, 0) - coalesce(sn.s_trs, 0) - coalesce(sn.s_acc, 0), 0) as oth,
           case when coalesce(sn.s_ex, 0) > 0 then round(100 * greatest(coalesce(sn.s_sh, 0) - coalesce(sn.s_trs, 0) - coalesce(sn.s_acc, 0), 0) / sn.s_ex, 4) end as cpct,
           coalesce(a.pts, 0) as pts,
           coalesce(a.late_n, 0) as late_n,
           coalesce(a.os_n, 0) as os_n, coalesce(a.cs_n, 0) as cs_n,
           case when coalesce(sn.s_ex, 0) - coalesce(sn.s_trs, 0) > 0 then round(100 * (coalesce(sn.s_ma, 0) + sn.s_acc) / (sn.s_ex - sn.s_trs), 4) end as mrate
      from public.stores s join public.circles c on c.id = s.circle_id
      left join agg a on a.sid = s.id left join snap sn on sn.sid = s.id
     where s.active
  )
  select id, code, name, circle_id, circle, held::int, done_n::int, ex, ma, sh, trs, oth, acc, cpct, pts, mrate, late_n::int,
         public._store_level(done_n::int, held::int, mrate, cpct, late_n::int),
         (dense_rank() over (order by pts desc, cpct asc nulls last))::int, (count(*) over ())::int,
         (dense_rank() over (partition by circle_id order by pts desc, cpct asc nulls last))::int, (count(*) over (partition by circle_id))::int,
         os_n::int, cs_n::int
    from base
$$;

-- ---------- STORE USER: adds oneshot / cleansweep season counts and each cycle's bonus ----------
create or replace function public.rank_my_store(p_from timestamptz, p_to timestamptz) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_store uuid := public.my_store_id(); r record;
begin
  if public.app_role() is distinct from 'STORE_USER' or v_store is null then
    raise exception 'You do not have permission to perform this action.' using errcode = '42501'; end if;
  select * into r from public._store_rank(p_from, p_to) where store_id = v_store;
  if not found then return jsonb_build_object('ranked', false); end if;
  return jsonb_build_object('ranked', true, 'store', r.code, 'circle', r.circle, 'points', r.points, 'cycles_done', r.cycles_done, 'cycles_held', r.cycles_held,
    'short', r.short, 'short_transit', r.short_transit, 'short_other', r.short_other, 'short_explained', r.short_explained,
    'short_other_reported', r.short_other + r.short_explained, 'counted_short_pct', r.counted_short_pct,
    'match_rate', r.match_rate, 'level', r.level, 'late_count', r.late_count, 'oneshot', r.oneshot, 'cleansweep', r.cleansweep,
    'level_points', (select coalesce(jsonb_object_agg(t.level, t.mp), '{}'::jsonb)
                       from (select level, min(points) as mp from public._store_rank(p_from, p_to) where cycles_done > 0 group by level) t),
    'pan_rank', r.pan_rank, 'pan_total', r.pan_total, 'circle_rank', r.circle_rank, 'circle_total', r.circle_total,
    'cycles', (select coalesce(jsonb_agg(jsonb_build_object('name', c.name, 'status', c.status, 'done', ls.id is not null,
          'short', ls.short_units, 'short_transit', coalesce(tr.q, 0), 'short_other', (ls.short_units - coalesce(tr.q, 0)) - coalesce(rv.q, 0),
          'short_other_reported', ls.short_units - coalesce(tr.q, 0), 'explained', coalesce(rv.q, 0),
          'match_rate', case when ls.id is not null and coalesce(ls.expected_units - coalesce(tr.q, 0), 0) > 0 then round(100 * (ls.matched_units + coalesce(rv.q, 0)) / (ls.expected_units - coalesce(tr.q, 0)), 2) end,
          'points', case when ls.id is not null then public._rank_points(ls.expected_units - coalesce(tr.q, 0), ls.matched_units + coalesce(rv.q, 0)) + bx.bon else 0 end,
          'bonus', case when ls.id is not null then bx.bon else 0 end) order by c.created_at desc), '[]'::jsonb)
        from public.audit_cycles c
        left join lateral (select x.* from public.audit_sessions x where x.audit_cycle_id = c.id and x.store_id = v_store and x.status = 'LOCKED' order by x.version desc limit 1) ls on true
        left join lateral (select sum(r2.short_qty) as q from public.reconciliation_results r2 where r2.session_id = ls.id and r2.result = 'SHORT' and r2.inventory_status ilike '%transit%') tr on ls.id is not null
        left join lateral (select coalesce(sum(least(rr.accepted_qty, r2.short_qty)), 0) as q
                             from public.reconciliation_results r2
                             join public.result_remarks rr on rr.store_id = v_store and rr.audit_cycle_id = c.id
                               and rr.item_code = r2.item_code and rr.inventory_status = coalesce(r2.inventory_status, '')
                               and rr.item_quality = coalesce(r2.item_quality, '') and rr.item_sno = coalesce(r2.item_sno, '')
                            where r2.session_id = ls.id and r2.result = 'SHORT'
                              and not (coalesce(r2.inventory_status, '') ilike '%transit%')
                              and rr.status = 'REVIEWED' and coalesce(rr.accepted_qty, 0) > 0) rv on ls.id is not null
        left join lateral (select case when exists(select 1 from public.audit_sessions rx where rx.audit_cycle_id = c.id and rx.store_id = v_store and rx.reopened_at is not null) then 0
                                       when (coalesce(ls.short_units, 0) - coalesce(tr.q, 0)) <= 0 then 10
                                       when coalesce(rv.q, 0) >= (coalesce(ls.short_units, 0) - coalesce(tr.q, 0)) then 5
                                       else 0 end as bon) bx on ls.id is not null
       where c.status <> 'DRAFT'
         and c.created_at >= coalesce(p_from, '-infinity'::timestamptz) and c.created_at < coalesce(p_to, 'infinity'::timestamptz)
         and (ls.id is not null or (c.status <> 'ACTIVE' and c.created_at >= (select created_at from public.stores where id = v_store)))));
end $$;

-- ---------- ADMIN / CIRCLE HEAD: adds oneshot / cleansweep season counts per store ----------
create or replace function public.rank_staff(p_from timestamptz, p_to timestamptz) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_role public.user_role := public.app_role();
begin
  if v_role is null or v_role not in ('ADMIN', 'CIRCLE_HEAD') then
    raise exception 'You do not have permission to perform this action.' using errcode = '42501'; end if;
  return jsonb_build_object('role', v_role,
    'stores', (select coalesce(jsonb_agg(jsonb_build_object('id', store_id, 'code', code, 'name', name, 'circle', circle, 'points', points, 'cycles_done', cycles_done, 'cycles_held', cycles_held,
                 'short', short, 'short_transit', short_transit, 'short_other', short_other, 'counted_short_pct', counted_short_pct,
                 'match_rate', match_rate, 'level', level, 'late_count', late_count, 'oneshot', oneshot, 'cleansweep', cleansweep,
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

revoke execute on function public._store_rank(timestamptz, timestamptz) from public, anon, authenticated;
revoke execute on function public.rank_my_store(timestamptz, timestamptz), public.rank_staff(timestamptz, timestamptz) from public, anon;
grant execute on function public.rank_my_store(timestamptz, timestamptz), public.rank_staff(timestamptz, timestamptz) to authenticated;
