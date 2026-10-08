-- =====================================================================
-- 04_phase2.sql | Phase 2 server functions. Run after 01_schema.sql and 03_real_data.sql.
-- =====================================================================

-- extra log types used by the upload wizard
alter table public.audit_events drop constraint audit_events_event_type_check;
alter table public.audit_events add constraint audit_events_event_type_check check (event_type in (
  'LOGIN','AUDIT_STARTED','SERIAL_SCANNED','SERIAL_DUPLICATE','SERIAL_NOT_FOUND','UNLISTED_SERIAL_ADDED',
  'NON_SERIAL_ADDED','ENTRY_REMOVED','ENTRY_EDITED','PREVIEW_OPENED','AUDIT_SUBMITTED','AUDIT_LOCKED',
  'AUDIT_REOPENED','BASE_UPLOADED','BASE_FROZEN','USER_APPROVED','USER_REJECTED','USER_STORE_CHANGED',
  'REPORT_EXPORTED','VALIDATION_FAILED','STORE_REPORT_NAME_SET','BASE_UPLOAD_WARNING'));

-- Save the name a store carries in its stock report (used only to warn on mismatches; never routes data)
create or replace function public.set_store_report_name(p_store uuid, p_name text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.can_manage_store(p_store) then
    raise exception 'You do not have permission to perform this action.' using errcode = '42501';
  end if;
  update public.stores set report_name = nullif(btrim(p_name), '') where id = p_store;
  perform public.log_event('STORE_REPORT_NAME_SET', p_store, null, null, null, jsonb_build_object('report_name', p_name));
end $$;

-- Freeze a DRAFT upload: re-validates server-side, supersedes the previous frozen version,
-- and refuses to swap the base once an audit has started for that cycle + store.
create or replace function public.freeze_base_stock(p_upload_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare u public.base_stock_uploads; n int; ser int; v_prev boolean;
begin
  select * into u from public.base_stock_uploads where id = p_upload_id for update;
  if not found or not public.can_manage_store(u.store_id) then
    raise exception 'You do not have permission to perform this action.' using errcode = '42501';
  end if;
  if u.status <> 'DRAFT' then raise exception 'Only a draft upload can be frozen.' using errcode = 'P0001'; end if;

  select count(*), count(*) filter (where item_sno is not null) into n, ser
    from public.base_stock where upload_id = p_upload_id;
  if n = 0 then raise exception 'The upload has no rows.' using errcode = 'P0001'; end if;
  if exists (select 1 from public.base_stock where upload_id = p_upload_id and btrim(item_code) = '') then
    raise exception 'The upload contains blank item codes.' using errcode = 'P0001'; end if;

  v_prev := exists (select 1 from public.base_stock_uploads
                    where audit_cycle_id = u.audit_cycle_id and store_id = u.store_id and status = 'FROZEN');
  if v_prev and exists (select 1 from public.audit_sessions
                        where audit_cycle_id = u.audit_cycle_id and store_id = u.store_id) then
    raise exception 'An audit has already started for this store. The base stock cannot be replaced.' using errcode = '42501';
  end if;

  update public.base_stock_uploads set status = 'SUPERSEDED'
   where audit_cycle_id = u.audit_cycle_id and store_id = u.store_id and status = 'FROZEN';
  update public.base_stock_uploads
     set status = 'FROZEN', frozen_by = auth.uid(), frozen_at = now(),
         rows_valid = n, serialized_count = ser, non_serialized_count = n - ser,
         version = coalesce((select max(version) from public.base_stock_uploads
                             where audit_cycle_id = u.audit_cycle_id and store_id = u.store_id and id <> u.id), 0) + 1
   where id = p_upload_id;
  insert into public.audit_cycle_stores(audit_cycle_id, store_id, active_upload_id, frozen_at)
  values (u.audit_cycle_id, u.store_id, p_upload_id, now())
  on conflict (audit_cycle_id, store_id) do update set active_upload_id = excluded.active_upload_id, frozen_at = excluded.frozen_at;
  perform public.log_event('BASE_FROZEN', u.store_id, u.audit_cycle_id, null, p_upload_id,
          jsonb_build_object('rows', n, 'serialized', ser, 'non_serialized', n - ser));
end $$;

-- Wizard events (upload / mismatch warnings / validation failures) written by the browser, whitelisted
create or replace function public.log_upload_event(p_type text, p_store uuid, p_cycle uuid, p_upload uuid, p_meta jsonb default '{}')
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_type not in ('BASE_UPLOADED','BASE_UPLOAD_WARNING','VALIDATION_FAILED') or not public.can_manage_store(p_store) then
    raise exception 'You do not have permission to perform this action.' using errcode = '42501';
  end if;
  perform public.log_event(p_type, p_store, p_cycle, null, p_upload, p_meta);
end $$;

revoke execute on function public.set_store_report_name(uuid,text), public.freeze_base_stock(uuid),
  public.log_upload_event(text,uuid,uuid,uuid,jsonb) from public, anon;
grant execute on function public.set_store_report_name(uuid,text), public.freeze_base_stock(uuid),
  public.log_upload_event(text,uuid,uuid,uuid,jsonb) to authenticated;
