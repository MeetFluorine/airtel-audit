-- =====================================================================
-- 09_phase5.sql | Admin / Circle Head dashboards.
-- Run after 08_typeahead.sql.
--
-- Speed: per-store totals are stored when a base is frozen and when an audit is submitted, so the dashboard
-- reads a few dozen small rows instead of re-adding every stock row on every page load.
-- Scope: every function checks the caller is ADMIN or CIRCLE_HEAD and returns ONLY stores they manage
-- (a Circle Head never sees another circle). Store users are refused.
--
-- Health status of a circle head / circle (computed automatically from completed audits):
--   HEALTHY >= 90% match | WARNING 75% to < 90% | CRITICAL < 75% | PENDING = no completed audit yet
--   (change the two numbers in _health() below if you want different thresholds)
-- =====================================================================

alter table public.base_stock_uploads add column if not exists expected_units numeric;
alter table public.audit_sessions
  add column if not exists expected_units numeric, add column if not exists physical_units numeric, add column if not exists matched_units numeric,
  add column if not exists short_units numeric,    add column if not exists excess_units numeric;

-- one-time backfill for anything frozen / submitted before this update
update public.base_stock_uploads u set expected_units = (
  select count(*) filter (where item_sno is not null) + coalesce(sum(item_qnty) filter (where item_sno is null), 0)
    from public.base_stock b where b.upload_id = u.id)
 where u.status in ('FROZEN','SUPERSEDED') and u.expected_units is null;
update public.audit_sessions s set expected_units = r.e, physical_units = r.p, matched_units = r.m, short_units = r.sh, excess_units = r.x
  from (select session_id, sum(expected_qty) e, sum(physical_qty) p, sum(matched_qty) m, sum(short_qty) sh, sum(excess_qty) x
          from public.reconciliation_results group by session_id) r
 where r.session_id = s.id and s.expected_units is null;

-- freeze now also records the expected units of the base
create or replace function public.freeze_base_stock(p_upload_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare u public.base_stock_uploads; n int; ser int; nsq numeric; v_prev boolean;
begin
  select * into u from public.base_stock_uploads where id = p_upload_id for update;
  if not found or not public.can_manage_store(u.store_id) then
    raise exception 'You do not have permission to perform this action.' using errcode = '42501'; end if;
  if u.status <> 'DRAFT' then raise exception 'Only a draft upload can be frozen.' using errcode = 'P0001'; end if;
  select count(*), count(*) filter (where item_sno is not null), coalesce(sum(item_qnty) filter (where item_sno is null), 0) into n, ser, nsq
    from public.base_stock where upload_id = p_upload_id;
  if n = 0 then raise exception 'The upload has no rows.' using errcode = 'P0001'; end if;
  if exists (select 1 from public.base_stock where upload_id = p_upload_id and btrim(item_code) = '') then
    raise exception 'The upload contains blank item codes.' using errcode = 'P0001'; end if;
  v_prev := exists (select 1 from public.base_stock_uploads where audit_cycle_id = u.audit_cycle_id and store_id = u.store_id and status = 'FROZEN');
  if v_prev and exists (select 1 from public.audit_sessions where audit_cycle_id = u.audit_cycle_id and store_id = u.store_id) then
    raise exception 'An audit has already started for this store. The base stock cannot be replaced.' using errcode = '42501'; end if;
  update public.base_stock_uploads set status = 'SUPERSEDED' where audit_cycle_id = u.audit_cycle_id and store_id = u.store_id and status = 'FROZEN';
  update public.base_stock_uploads
     set status = 'FROZEN', frozen_by = auth.uid(), frozen_at = now(), rows_valid = n, serialized_count = ser, non_serialized_count = n - ser, expected_units = ser + nsq,
         version = coalesce((select max(version) from public.base_stock_uploads where audit_cycle_id = u.audit_cycle_id and store_id = u.store_id and id <> u.id), 0) + 1
   where id = p_upload_id;
  insert into public.audit_cycle_stores(audit_cycle_id, store_id, active_upload_id, frozen_at) values (u.audit_cycle_id, u.store_id, p_upload_id, now())
  on conflict (audit_cycle_id, store_id) do update set active_upload_id = excluded.active_upload_id, frozen_at = excluded.frozen_at;
  perform public.log_event('BASE_FROZEN', u.store_id, u.audit_cycle_id, null, p_upload_id, jsonb_build_object('rows', n, 'serialized', ser, 'non_serialized', n - ser));
end $$;

-- submit now also stores the result totals on the session
create or replace function public.submit_audit(p_session uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s public.audit_sessions; v jsonb;
begin
  s := public._session_for(p_session, true);
  select * into s from public.audit_sessions where id = p_session for update;
  if s.status <> 'IN_PROGRESS' then raise exception 'Audit is already locked.' using errcode = '42501'; end if;
  if (public._counts(p_session)->>'units')::numeric = 0 then
    raise exception 'Add at least one item before completing the audit.' using errcode = 'P0001'; end if;
  perform public.log_event('AUDIT_SUBMITTED', s.store_id, s.audit_cycle_id, s.id, s.id, public._counts(p_session));
  update public.audit_sessions set status = 'LOCKED', submitted_by = auth.uid(), submitted_at = now() where id = p_session;
  perform public._reconcile(p_session);
  v := public.result_summary(p_session);
  update public.audit_sessions set expected_units = (v->>'expected')::numeric, physical_units = (v->>'physical')::numeric, matched_units = (v->>'matched')::numeric,
         short_units = (v->>'short')::numeric, excess_units = (v->>'excess')::numeric where id = p_session;
  perform public.log_event('AUDIT_LOCKED', s.store_id, s.audit_cycle_id, s.id, s.id, '{}');
  return v;
end $$;

-- ---------- helpers ------------------------------------------------------
create or replace function public._health(p_rate numeric, p_completed bigint) returns text
language sql immutable set search_path = '' as $$
  select case when coalesce(p_completed, 0) = 0 or p_rate is null then 'PENDING' when p_rate >= 90 then 'HEALTHY' when p_rate >= 75 then 'WARNING' else 'CRITICAL' end $$;

create or replace function public._scope() returns table(store_id uuid)
language sql stable security definer set search_path = '' as $$
  select s.id from public.stores s where s.active and public.can_manage_store(s.id) $$;

create or replace function public._dash_rows(p_cycle uuid)
returns table(store_id uuid, code text, name text, circle_id uuid, circle text, base_frozen boolean, base_expected numeric, session_id uuid, version int,
              expected numeric, physical numeric, matched numeric, short numeric, excess numeric, match_rate numeric, audit_status text, last_updated timestamptz)
language sql stable security definer set search_path = '' as $$
  select s.id, s.code, s.name, c.id, c.code, (a.active_upload_id is not null), u.expected_units, ses.id, ses.version,
         coalesce(ses.expected_units, u.expected_units),
         case when ses.status = 'LOCKED' then ses.physical_units else live.units end,
         ses.matched_units, ses.short_units, ses.excess_units,
         case when ses.status = 'LOCKED' and coalesce(ses.expected_units, 0) > 0 then round(100 * ses.matched_units / ses.expected_units, 1) end,
         case when ses.id is null then 'NOT_STARTED' when ses.status = 'LOCKED' then 'COMPLETED' else 'IN_PROGRESS' end,
         greatest(ses.submitted_at, ses.started_at, live.last_at)
    from public.stores s
    join public.circles c on c.id = s.circle_id
    join public._scope() sc on sc.store_id = s.id
    left join public.audit_cycle_stores a on a.audit_cycle_id = p_cycle and a.store_id = s.id
    left join public.base_stock_uploads u on u.id = a.active_upload_id
    left join lateral (select * from public.audit_sessions x where x.audit_cycle_id = p_cycle and x.store_id = s.id and x.status in ('IN_PROGRESS','LOCKED') order by x.version desc limit 1) ses on true
    left join lateral (select (select count(*) from public.audit_serial_scans where session_id = ses.id) + coalesce((select sum(physical_qty) from public.audit_non_serial_entries where session_id = ses.id), 0) as units,
                              greatest((select max(scanned_at) from public.audit_serial_scans where session_id = ses.id), (select max(updated_at) from public.audit_non_serial_entries where session_id = ses.id)) as last_at
                        where ses.status = 'IN_PROGRESS') live on true
$$;
revoke execute on function public._scope(), public._dash_rows(uuid), public._health(numeric, bigint) from public, anon, authenticated;

-- ---------- RPCs (staff only) ----------------------------------------------
create or replace function public.dash_stores(p_cycle uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if public.app_role() not in ('ADMIN','CIRCLE_HEAD') then raise exception 'You do not have permission to perform this action.' using errcode = '42501'; end if;
  return (select coalesce(jsonb_agg(to_jsonb(r) order by r.circle, r.code), '[]') from public._dash_rows(p_cycle) r);
end $$;

create or replace function public.dash_overview(p_cycle uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v jsonb;
begin
  if public.app_role() not in ('ADMIN','CIRCLE_HEAD') then raise exception 'You do not have permission to perform this action.' using errcode = '42501'; end if;
  with r as (select * from public._dash_rows(p_cycle)),
  tot as (
    select count(*) as stores, count(*) filter (where audit_status = 'COMPLETED') as completed, count(*) filter (where audit_status = 'IN_PROGRESS') as in_progress,
           count(*) filter (where audit_status = 'NOT_STARTED') as not_started, count(*) filter (where base_frozen) as base_frozen,
           coalesce(sum(expected) filter (where audit_status = 'COMPLETED'), 0) as expected, coalesce(sum(physical) filter (where audit_status = 'COMPLETED'), 0) as physical,
           coalesce(sum(matched) filter (where audit_status = 'COMPLETED'), 0) as matched, coalesce(sum(short) filter (where audit_status = 'COMPLETED'), 0) as short,
           coalesce(sum(excess) filter (where audit_status = 'COMPLETED'), 0) as excess from r),
  grp as (
    select a.user_id::text as key, p.full_name as label, a.circle_id from public.circle_head_assignments a
      join public.profiles p on p.id = a.user_id and p.status = 'APPROVED' and p.role = 'CIRCLE_HEAD'
    union all
    select 'circle:' || c.code, 'Unassigned · ' || c.code, c.id from public.circles c
     where not exists (select 1 from public.circle_head_assignments a2 join public.profiles p2 on p2.id = a2.user_id and p2.status = 'APPROVED' and p2.role = 'CIRCLE_HEAD' where a2.circle_id = c.id)),
  heads as (
    select g.key, g.label, array_agg(distinct r.circle order by r.circle) as circles, count(*) as stores, count(*) filter (where r.audit_status = 'COMPLETED') as completed,
           coalesce(sum(r.expected) filter (where r.audit_status = 'COMPLETED'), 0) as expected, coalesce(sum(r.physical) filter (where r.audit_status = 'COMPLETED'), 0) as physical,
           coalesce(sum(r.matched) filter (where r.audit_status = 'COMPLETED'), 0) as matched, coalesce(sum(r.short) filter (where r.audit_status = 'COMPLETED'), 0) as short,
           coalesce(sum(r.excess) filter (where r.audit_status = 'COMPLETED'), 0) as excess
      from grp g join r on r.circle_id = g.circle_id group by g.key, g.label),
  integ as (
    select count(*) filter (where event_type = 'SERIAL_DUPLICATE') as duplicates, count(*) filter (where event_type = 'UNLISTED_SERIAL_ADDED') as unlisted,
           count(*) filter (where event_type = 'ENTRY_EDITED') as edited, count(*) filter (where event_type = 'AUDIT_REOPENED') as reopened,
           count(*) filter (where event_type in ('SERIAL_NOT_FOUND','VALIDATION_FAILED')) as failed_validation
      from public.audit_events where audit_cycle_id = p_cycle and store_id in (select store_id from public._scope())),
  act as (
    select e.id, e.event_type, e.created_at, e.store_id, s.code as store_code, pr.full_name as actor
      from public.audit_events e left join public.stores s on s.id = e.store_id left join public.profiles pr on pr.id = e.user_id
     where e.audit_cycle_id = p_cycle and e.store_id in (select store_id from public._scope())
       and e.event_type in ('AUDIT_STARTED','AUDIT_SUBMITTED','AUDIT_REOPENED','BASE_FROZEN')
     order by e.created_at desc limit 12)
  select jsonb_build_object(
    'totals', (select to_jsonb(tot) || jsonb_build_object('match_rate', case when tot.expected > 0 then round(100 * tot.matched / tot.expected, 1) end) from tot),
    'heads', (select coalesce(jsonb_agg(to_jsonb(h) || jsonb_build_object('match_rate', case when h.expected > 0 then round(100 * h.matched / h.expected, 1) end,
                'status', public._health(case when h.expected > 0 then round(100 * h.matched / h.expected, 1) end, h.completed)) order by h.label), '[]') from heads h),
    'integrity', (select to_jsonb(integ) from integ),
    'activity', (select coalesce(jsonb_agg(to_jsonb(act) order by act.created_at desc), '[]') from act)) into v;
  return v;
end $$;

-- "Where is this item / serial?" across the stores the caller manages (base stock + what was physically scanned)
create or replace function public.dash_search(p_cycle uuid, p_q text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v text := upper(btrim(coalesce(p_q, '')));
begin
  if public.app_role() not in ('ADMIN','CIRCLE_HEAD') then raise exception 'You do not have permission to perform this action.' using errcode = '42501'; end if;
  if length(v) < 3 then return '[]'::jsonb; end if;
  return (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from (
    (select 'Base stock'::text as source, s.id as store_id, s.code as store_code, b.item_code, b.item_sno as serial, b.item_description
       from public.base_stock b join public.audit_cycle_stores a on a.active_upload_id = b.upload_id and a.audit_cycle_id = p_cycle
       join public.stores s on s.id = b.store_id
      where b.store_id in (select store_id from public._scope()) and (starts_with(coalesce(b.item_sno, ''), v) or strpos(upper(b.item_code), v) > 0) limit 60)
    union all
    (select 'Scanned', s.id, s.code, sc.item_code, sc.item_sno, null::text
       from public.audit_serial_scans sc join public.stores s on s.id = sc.store_id
      where sc.audit_cycle_id = p_cycle and sc.store_id in (select store_id from public._scope()) and (starts_with(sc.item_sno, v) or strpos(upper(sc.item_code), v) > 0) limit 60)) x);
end $$;

-- For excess serials: does the serial exist in ANOTHER store's frozen base this cycle? (information only; results never change)
create or replace function public.serial_cross_store(p_cycle uuid, p_store uuid, p_serials text[]) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if public.app_role() not in ('ADMIN','CIRCLE_HEAD') or not public.can_manage_store(p_store) then
    raise exception 'You do not have permission to perform this action.' using errcode = '42501'; end if;
  return (select coalesce(jsonb_object_agg(t.serial, t.label), '{}') from (
    select b.item_sno as serial, case when public.can_manage_store(b.store_id) then s.code else 'Another circle' end as label
      from public.base_stock b join public.audit_cycle_stores a on a.active_upload_id = b.upload_id and a.audit_cycle_id = p_cycle
      join public.stores s on s.id = b.store_id
     where b.audit_cycle_id = p_cycle and b.store_id <> p_store and b.item_sno = any (p_serials)) t);
end $$;

grant execute on function public.dash_stores(uuid), public.dash_overview(uuid), public.dash_search(uuid, text), public.serial_cross_store(uuid, uuid, text[]) to authenticated;
