-- =====================================================================
-- 17_close_cycle_store_base.sql
--   1) Admin can CLOSE any audit cycle whenever they want (no need to create a new one).
--   2) A STORE USER can set up (upload + freeze) the base data of THEIR OWN store for an open cycle.
-- Run once in the Supabase SQL Editor, after 16_result_remarks.sql (safe to re-run).
--
-- Store-user rules (enforced here, on the server, not just in the screen):
--   * only for their own store, only for an ACTIVE (open) cycle
--   * only the FIRST upload: once base data is frozen, only Admin / Circle Head can revise it
--   * never before-the-fact visibility: store users still CANNOT read base_stock rows (no select policy is added);
--     they only get write access through the functions below.
-- =====================================================================

-- ---------- 1) new log entry type ----------
alter table public.audit_events drop constraint if exists audit_events_event_type_check;
alter table public.audit_events add constraint audit_events_event_type_check check (event_type in (
  'LOGIN','AUDIT_STARTED','SERIAL_SCANNED','SERIAL_DUPLICATE','SERIAL_NOT_FOUND','UNLISTED_SERIAL_ADDED',
  'NON_SERIAL_ADDED','ENTRY_REMOVED','ENTRY_EDITED','PREVIEW_OPENED','AUDIT_SUBMITTED','AUDIT_LOCKED',
  'AUDIT_REOPENED','BASE_UPLOADED','BASE_FROZEN','USER_APPROVED','USER_REJECTED','USER_STORE_CHANGED',
  'REPORT_EXPORTED','VALIDATION_FAILED','STORE_REPORT_NAME_SET','BASE_UPLOAD_WARNING','CYCLE_DELETED','USER_DELETED',
  'CYCLE_CLOSED'));

-- ---------- 2) Admin: close a cycle ----------
create or replace function public.admin_close_cycle(p_cycle uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_name text; v_status text; v_open int;
begin
  if not public.is_admin() then raise exception 'You do not have permission to perform this action.' using errcode = '42501'; end if;
  select name, status::text into v_name, v_status from public.audit_cycles where id = p_cycle for update;
  if not found then raise exception 'Cycle not found.' using errcode = 'P0002'; end if;
  if v_status <> 'ACTIVE' then raise exception 'This cycle is already closed.' using errcode = 'P0001'; end if;
  select count(*) into v_open from public.audit_sessions where audit_cycle_id = p_cycle and status = 'IN_PROGRESS';
  update public.audit_cycles set status = 'COMPLETED' where id = p_cycle;           -- data stays; same state a new cycle puts the old one in
  perform public.log_event('CYCLE_CLOSED', null, p_cycle, null, null, jsonb_build_object('name', v_name, 'audits_in_progress', v_open));
  return jsonb_build_object('name', v_name, 'audits_in_progress', v_open);
end $$;

-- ---------- 3) who may set up base data for a store ----------
create or replace function public.can_setup_base(p_store uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(public.can_manage_store(p_store)
         or (public.app_role() = 'STORE_USER' and public.my_store_id() is not null and public.my_store_id() = p_store), false)
$$;

-- freeze: same as before for Admin / Circle Head; a store user may only freeze the FIRST base of an OPEN cycle
create or replace function public.freeze_base_stock(p_upload_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare u public.base_stock_uploads; n int; ser int; nsq numeric; v_prev boolean;
begin
  select * into u from public.base_stock_uploads where id = p_upload_id for update;
  if not found or not public.can_setup_base(u.store_id) then
    raise exception 'You do not have permission to perform this action.' using errcode = '42501'; end if;
  if u.status <> 'DRAFT' then raise exception 'Only a draft upload can be frozen.' using errcode = 'P0001'; end if;
  select count(*), count(*) filter (where item_sno is not null), coalesce(sum(item_qnty) filter (where item_sno is null), 0) into n, ser, nsq
    from public.base_stock where upload_id = p_upload_id;
  if n = 0 then raise exception 'The upload has no rows.' using errcode = 'P0001'; end if;
  if exists (select 1 from public.base_stock where upload_id = p_upload_id and btrim(item_code) = '') then
    raise exception 'The upload contains blank item codes.' using errcode = 'P0001'; end if;
  v_prev := exists (select 1 from public.base_stock_uploads where audit_cycle_id = u.audit_cycle_id and store_id = u.store_id and status = 'FROZEN');
  if not public.can_manage_store(u.store_id) then
    if v_prev then raise exception 'Base data is already uploaded for this store. Ask your Circle Head or Admin to revise it.' using errcode = '42501'; end if;
    if (select status::text from public.audit_cycles where id = u.audit_cycle_id) is distinct from 'ACTIVE' then
      raise exception 'This audit cycle is closed. Base data can only be set up for an open cycle.' using errcode = '42501'; end if;
  end if;
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

-- upload-wizard log entries: the store user may log for their own store too
create or replace function public.log_upload_event(p_type text, p_store uuid, p_cycle uuid, p_upload uuid, p_meta jsonb default '{}')
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_type not in ('BASE_UPLOADED','BASE_UPLOAD_WARNING','VALIDATION_FAILED') or not public.can_setup_base(p_store) then
    raise exception 'You do not have permission to perform this action.' using errcode = '42501';
  end if;
  perform public.log_event(p_type, p_store, p_cycle, null, p_upload, p_meta);
end $$;

-- original Excel backup: a store user may add the file for their own store (still cannot read or delete files)
drop policy if exists bsf_insert on storage.objects;
create policy bsf_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'base-stock-files' and public.can_setup_base(public.try_uuid(split_part(name,'/',2))));

-- ---------- 4) store-user functions (the store is always taken from the login, never from the screen) ----------
-- open cycles + whether this store's base data is already in (no stock data is returned)
create or replace function public.store_open_cycles() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_store uuid := public.my_store_id();
begin
  if public.app_role() is distinct from 'STORE_USER' or v_store is null then
    raise exception 'You do not have permission to perform this action.' using errcode = '42501'; end if;
  return jsonb_build_object('store_id', v_store, 'cycles', (
    select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'base_frozen', a.active_upload_id is not null, 'frozen_at', a.frozen_at,
             'audit_started', exists (select 1 from public.audit_sessions s where s.audit_cycle_id = c.id and s.store_id = v_store)) order by c.created_at desc), '[]'::jsonb)
      from public.audit_cycles c left join public.audit_cycle_stores a on a.audit_cycle_id = c.id and a.store_id = v_store
     where c.status = 'ACTIVE'));
end $$;

create or replace function public.store_base_begin(p_cycle uuid, p_file text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_store uuid := public.my_store_id(); v_status text; v_id uuid;
begin
  if public.app_role() is distinct from 'STORE_USER' or v_store is null then
    raise exception 'You do not have permission to perform this action.' using errcode = '42501'; end if;
  select status::text into v_status from public.audit_cycles where id = p_cycle;
  if not found then raise exception 'Cycle not found.' using errcode = 'P0002'; end if;
  if v_status <> 'ACTIVE' then raise exception 'This audit cycle is closed. Base data can only be set up for an open cycle.' using errcode = 'P0001'; end if;
  if exists (select 1 from public.base_stock_uploads where audit_cycle_id = p_cycle and store_id = v_store and status = 'FROZEN') then
    raise exception 'Base data is already uploaded for this store. Ask your Circle Head or Admin to revise it.' using errcode = 'P0001'; end if;
  if exists (select 1 from public.audit_sessions where audit_cycle_id = p_cycle and store_id = v_store) then
    raise exception 'An audit has already started for this store. The base stock cannot be replaced.' using errcode = 'P0001'; end if;
  delete from public.base_stock where audit_cycle_id = p_cycle and store_id = v_store and upload_id in
    (select id from public.base_stock_uploads where audit_cycle_id = p_cycle and store_id = v_store and status = 'DRAFT');
  delete from public.base_stock_uploads where audit_cycle_id = p_cycle and store_id = v_store and status = 'DRAFT';     -- leftovers of an earlier failed try
  insert into public.base_stock_uploads(audit_cycle_id, store_id, version, source_file_name)
  values (p_cycle, v_store, coalesce((select max(version) from public.base_stock_uploads where audit_cycle_id = p_cycle and store_id = v_store), 0) + 1, left(p_file, 255))
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.store_base_rows(p_upload uuid, p_rows jsonb) returns int
language plpgsql security definer set search_path = '' as $$
declare u public.base_stock_uploads; n int;
begin
  select * into u from public.base_stock_uploads where id = p_upload;
  if not found or u.status <> 'DRAFT' or public.app_role() is distinct from 'STORE_USER' or public.my_store_id() is distinct from u.store_id then
    raise exception 'You do not have permission to perform this action.' using errcode = '42501'; end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 1000 then raise exception 'Too many rows in one batch.' using errcode = 'P0001'; end if;
  insert into public.base_stock(upload_id, audit_cycle_id, store_id, item_code, inventory_status, item_description, item_uom, item_qnty, item_quality, item_sno)
  select p_upload, u.audit_cycle_id, u.store_id, btrim(r.item_code), r.inventory_status, r.item_description, r.item_uom, r.item_qnty, r.item_quality, nullif(upper(btrim(r.item_sno)), '')
    from jsonb_to_recordset(p_rows) as r(item_code text, inventory_status text, item_description text, item_uom text, item_qnty numeric, item_quality text, item_sno text);
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function public.store_base_finish(p_upload uuid, p_path text, p_rows_uploaded int, p_errors jsonb default '{}') returns void
language plpgsql security definer set search_path = '' as $$
declare u public.base_stock_uploads;
begin
  select * into u from public.base_stock_uploads where id = p_upload;
  if not found or u.status <> 'DRAFT' or public.app_role() is distinct from 'STORE_USER' or public.my_store_id() is distinct from u.store_id then
    raise exception 'You do not have permission to perform this action.' using errcode = '42501'; end if;
  update public.base_stock_uploads set source_file_path = nullif(p_path, ''), rows_uploaded = coalesce(p_rows_uploaded, 0), error_summary = coalesce(p_errors, '{}'::jsonb)
   where id = p_upload;
  perform public.log_event('BASE_UPLOADED', u.store_id, u.audit_cycle_id, null, p_upload, jsonb_build_object('file', u.source_file_name, 'rows', p_rows_uploaded, 'by', 'store user'));
  perform public.freeze_base_stock(p_upload);
end $$;

create or replace function public.store_base_discard(p_upload uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare u public.base_stock_uploads;
begin
  select * into u from public.base_stock_uploads where id = p_upload;
  if not found then return; end if;
  if u.status <> 'DRAFT' or public.app_role() is distinct from 'STORE_USER' or public.my_store_id() is distinct from u.store_id then
    raise exception 'You do not have permission to perform this action.' using errcode = '42501'; end if;
  delete from public.base_stock where upload_id = p_upload;
  delete from public.base_stock_uploads where id = p_upload;
end $$;

-- ---------- grants ----------
revoke execute on function public.admin_close_cycle(uuid), public.can_setup_base(uuid), public.store_open_cycles(), public.store_base_begin(uuid,text),
  public.store_base_rows(uuid,jsonb), public.store_base_finish(uuid,text,int,jsonb), public.store_base_discard(uuid) from public, anon;
grant execute on function public.admin_close_cycle(uuid), public.can_setup_base(uuid), public.store_open_cycles(), public.store_base_begin(uuid,text),
  public.store_base_rows(uuid,jsonb), public.store_base_finish(uuid,text,int,jsonb), public.store_base_discard(uuid) to authenticated;
