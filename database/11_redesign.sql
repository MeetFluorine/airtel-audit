-- =====================================================================
-- 11_redesign.sql | Supports the new UI: simple cycles (create / load / PERMANENT delete), sidebar progress,
-- dashboard trend + comparison, store variance breakdown, store locator / type.
-- Run after 10_phase6.sql.
--
-- PERMANENT DELETE: admin_purge_cycle removes the cycle and ALL of its data (base stock, audits, scans,
-- entries, reconciliation results). There is no archive. The audit LOG entries are deliberately kept
-- (the log is the system's accountability record) and one CYCLE_DELETED entry is added.
-- =====================================================================

-- ---------- stores: locator and store type (shown on the Stores page) ----------
alter table public.stores add column if not exists locator text;
alter table public.stores add column if not exists store_type text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'stores_store_type_check') then
    alter table public.stores add constraint stores_store_type_check check (store_type is null or store_type in ('Exclusive','Shared'));
  end if;
end $$;

-- the audit log must outlive the audits it describes: events keep their ids but no longer block deletion
alter table public.audit_events drop constraint if exists audit_events_session_id_fkey;

-- ---------- guards: allow the purge function (and only it) to remove audit history ----------
create or replace function public.block_mutation() returns trigger
language plpgsql set search_path = '' as $$
begin
  if coalesce(current_setting('app.bypass_guard', true), '') = 'on' and tg_table_name <> 'audit_events' then return old; end if;
  raise exception '% on % is not allowed (history is preserved).', tg_op, tg_table_name using errcode = '42501';
end $$;

create or replace function public.guard_open_session() returns trigger
language plpgsql set search_path = '' as $$
declare v_sid uuid := coalesce(new.session_id, old.session_id); s public.audit_sessions;
begin
  if tg_op = 'DELETE' and coalesce(current_setting('app.bypass_guard', true), '') = 'on' then return old; end if;
  select * into s from public.audit_sessions where id = v_sid;
  if not found or s.status <> 'IN_PROGRESS' then
    raise exception 'Audit is already locked.' using errcode = '42501';
  end if;
  if tg_op <> 'DELETE' then
    new.audit_cycle_id := s.audit_cycle_id;
    new.store_id := s.store_id;
    return new;
  end if;
  return old;
end $$;

-- ---------- simple cycle creation: a new cycle becomes THE current one ----------
create or replace function public.admin_create_cycle(p_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if not public.is_admin() then raise exception 'You do not have permission to perform this action.' using errcode = '42501'; end if;
  if length(btrim(coalesce(p_name, ''))) < 2 then raise exception 'Please enter a cycle name.' using errcode = 'P0001'; end if;
  update public.audit_cycles set status = 'COMPLETED' where status = 'ACTIVE';     -- previous cycle is closed (data stays until deleted)
  insert into public.audit_cycles(name, status) values (btrim(p_name), 'ACTIVE') returning id into v_id;
  return v_id;
end $$;

-- ---------- permanent delete ----------------------------------------------------
create or replace function public.admin_purge_cycle(p_cycle uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_name text; n_sess int; n_scan int; n_ent int; n_rec int; n_base int;
begin
  if not public.is_admin() then raise exception 'You do not have permission to perform this action.' using errcode = '42501'; end if;
  select name into v_name from public.audit_cycles where id = p_cycle;
  if not found then raise exception 'Cycle not found.' using errcode = 'P0002'; end if;
  perform set_config('app.bypass_guard', 'on', true);
  delete from public.client_events where session_id in (select id from public.audit_sessions where audit_cycle_id = p_cycle);
  delete from public.reconciliation_results where audit_cycle_id = p_cycle;             get diagnostics n_rec = row_count;
  delete from public.audit_serial_scans where audit_cycle_id = p_cycle;                 get diagnostics n_scan = row_count;
  delete from public.audit_non_serial_entries where audit_cycle_id = p_cycle;           get diagnostics n_ent = row_count;
  delete from public.audit_sessions where audit_cycle_id = p_cycle;                     get diagnostics n_sess = row_count;
  delete from public.audit_cycle_stores where audit_cycle_id = p_cycle;
  delete from public.base_stock where audit_cycle_id = p_cycle;                         get diagnostics n_base = row_count;
  delete from public.base_stock_uploads where audit_cycle_id = p_cycle;
  delete from public.audit_cycles where id = p_cycle;
  perform set_config('app.bypass_guard', 'off', true);
  perform public.log_event('CYCLE_DELETED', null, p_cycle, null, null,
          jsonb_build_object('name', v_name, 'audits', n_sess, 'scans', n_scan, 'entries', n_ent, 'result_rows', n_rec, 'base_rows', n_base));
  return jsonb_build_object('name', v_name, 'audits', n_sess, 'scans', n_scan, 'entries', n_ent, 'result_rows', n_rec, 'base_rows', n_base);
end $$;

-- ---------- sidebar progress, dashboard trend, store variance breakdown ----------
create or replace function public.cycle_progress(p_cycle uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if public.app_role() not in ('ADMIN','CIRCLE_HEAD') then raise exception 'You do not have permission to perform this action.' using errcode = '42501'; end if;
  return (select jsonb_build_object('completed', count(*) filter (where audit_status = 'COMPLETED'), 'total', count(*)) from public._dash_rows(p_cycle));
end $$;

-- the selected cycle and up to p_limit - 1 cycles before it (oldest first), for the trend chart and "vs last cycle"
create or replace function public.dash_trend(p_cycle uuid, p_limit int default 6) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if public.app_role() not in ('ADMIN','CIRCLE_HEAD') then raise exception 'You do not have permission to perform this action.' using errcode = '42501'; end if;
  return (select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at), '[]') from (
    select c.id, c.name, c.created_at, (select count(*) from public._scope()) as stores,
           count(ses.id) filter (where ses.status = 'LOCKED') as completed, count(ses.id) filter (where ses.status = 'IN_PROGRESS') as in_progress,
           coalesce(sum(ses.expected_units) filter (where ses.status = 'LOCKED'), 0) as expected, coalesce(sum(ses.matched_units) filter (where ses.status = 'LOCKED'), 0) as matched,
           coalesce(sum(ses.short_units) filter (where ses.status = 'LOCKED'), 0) as short, coalesce(sum(ses.excess_units) filter (where ses.status = 'LOCKED'), 0) as excess
      from (select * from public.audit_cycles where created_at <= (select created_at from public.audit_cycles where id = p_cycle) order by created_at desc limit greatest(p_limit, 1)) c
      left join lateral (select distinct on (s.store_id) s.* from public.audit_sessions s join public._scope() sc on sc.store_id = s.store_id
                          where s.audit_cycle_id = c.id and s.status in ('IN_PROGRESS','LOCKED') order by s.store_id, s.version desc) ses on true
     group by c.id, c.name, c.created_at) t);
end $$;

create or replace function public.store_variance_breakdown(p_session uuid) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'ser_short', count(*) filter (where is_serialized and result = 'SHORT'), 'ser_excess', count(*) filter (where is_serialized and result = 'EXCESS'),
    'non_short', coalesce(sum(short_qty) filter (where not is_serialized), 0), 'non_excess', coalesce(sum(excess_qty) filter (where not is_serialized), 0))
  from public.reconciliation_results where session_id = p_session
$$;

revoke execute on function public.admin_create_cycle(text), public.admin_purge_cycle(uuid), public.cycle_progress(uuid), public.dash_trend(uuid, int), public.store_variance_breakdown(uuid) from public, anon;
grant execute on function public.admin_create_cycle(text), public.admin_purge_cycle(uuid), public.cycle_progress(uuid), public.dash_trend(uuid, int), public.store_variance_breakdown(uuid) to authenticated;
