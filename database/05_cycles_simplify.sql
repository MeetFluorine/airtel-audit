-- =====================================================================
-- 05_cycles_simplify.sql | Simpler audit cycles: name only, every store takes part.
-- Run once in the Supabase SQL Editor (after 04_phase2.sql).
-- =====================================================================

-- cycles no longer need dates
alter table public.audit_cycles alter column start_date drop not null, alter column end_date drop not null;

-- the event log is permanent history, so it must survive a deleted cycle
alter table public.audit_events drop constraint if exists audit_events_audit_cycle_id_fkey;
alter table public.audit_events drop constraint audit_events_event_type_check;
alter table public.audit_events add constraint audit_events_event_type_check check (event_type in (
  'LOGIN','AUDIT_STARTED','SERIAL_SCANNED','SERIAL_DUPLICATE','SERIAL_NOT_FOUND','UNLISTED_SERIAL_ADDED',
  'NON_SERIAL_ADDED','ENTRY_REMOVED','ENTRY_EDITED','PREVIEW_OPENED','AUDIT_SUBMITTED','AUDIT_LOCKED',
  'AUDIT_REOPENED','BASE_UPLOADED','BASE_FROZEN','USER_APPROVED','USER_REJECTED','USER_STORE_CHANGED',
  'REPORT_EXPORTED','VALIDATION_FAILED','STORE_REPORT_NAME_SET','BASE_UPLOAD_WARNING','CYCLE_DELETED'));

-- frozen-base guards stay in force, except inside admin_delete_cycle (transaction-local flag)
create or replace function public.guard_base_stock() returns trigger
language plpgsql set search_path = '' as $$
begin
  if coalesce(current_setting('app.bypass_guard', true), '') = 'on' then return coalesce(new, old); end if;
  if exists (select 1 from public.base_stock_uploads u
             where u.id = coalesce(old.upload_id, new.upload_id) and u.status in ('FROZEN','SUPERSEDED')) then
    raise exception 'Base stock is frozen and cannot be changed.' using errcode = '42501';
  end if;
  return coalesce(new, old);
end $$;

create or replace function public.guard_upload_delete() returns trigger
language plpgsql set search_path = '' as $$
begin
  if coalesce(current_setting('app.bypass_guard', true), '') = 'on' then return old; end if;
  if old.status in ('FROZEN','SUPERSEDED') then
    raise exception 'A frozen base stock upload cannot be deleted.' using errcode = '42501';
  end if;
  return old;
end $$;

-- Admin-only: delete a cycle and its base stock. Refused once ANY audit exists (history is preserved).
create or replace function public.admin_delete_cycle(p_cycle uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_name text;
begin
  if not public.is_admin() then raise exception 'You do not have permission to perform this action.' using errcode = '42501'; end if;
  select name into v_name from public.audit_cycles where id = p_cycle;
  if not found then raise exception 'Cycle not found.' using errcode = 'P0002'; end if;
  if exists (select 1 from public.audit_sessions where audit_cycle_id = p_cycle) then
    raise exception 'Audits have already started for this cycle, so it cannot be deleted. Archive it instead.' using errcode = 'P0001';
  end if;
  perform set_config('app.bypass_guard', 'on', true);
  delete from public.audit_cycle_stores where audit_cycle_id = p_cycle;
  delete from public.base_stock where audit_cycle_id = p_cycle;
  delete from public.base_stock_uploads where audit_cycle_id = p_cycle;
  delete from public.audit_cycles where id = p_cycle;
  perform set_config('app.bypass_guard', 'off', true);
  perform public.log_event('CYCLE_DELETED', null, p_cycle, null, null, jsonb_build_object('name', v_name));
end $$;
revoke execute on function public.admin_delete_cycle(uuid) from public, anon;
grant execute on function public.admin_delete_cycle(uuid) to authenticated;
