-- =====================================================================
-- 06_phase3.sql | Store audit functions (scan, count, preview, remove).
-- Run after 05_cycles_simplify.sql.
-- Every function derives the user's store from auth.uid(); the browser never sends a store or cycle.
-- No function returns an expected quantity (blind count, Rule 9).
-- =====================================================================

-- replay protection: the same client event (e.g. a retried offline scan) is applied only once
create table if not exists public.client_events (
  client_event_id uuid primary key,
  session_id      uuid not null,
  created_at      timestamptz not null default now()
);
alter table public.client_events enable row level security;      -- no policies, no grants: internal only
revoke all on public.client_events from anon, authenticated;

-- ---------- internal helpers (not callable from the browser) ------------
create or replace function public._session_for(p_session uuid, p_need_open boolean) returns public.audit_sessions
language plpgsql security definer set search_path = '' as $$
declare s public.audit_sessions;
begin
  if public.app_role() is distinct from 'STORE_USER' then
    raise exception 'You do not have permission to perform this action.' using errcode = '42501'; end if;
  select * into s from public.audit_sessions where id = p_session;
  if not found or s.store_id is distinct from public.my_store_id() then
    raise exception 'You do not have permission to perform this action.' using errcode = '42501'; end if;
  if p_need_open and s.status <> 'IN_PROGRESS' then
    raise exception 'Audit is already locked.' using errcode = '42501'; end if;
  return s;
end $$;

create or replace function public._replay(p_event uuid, p_session uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if p_event is null then return false; end if;
  insert into public.client_events(client_event_id, session_id) values (p_event, p_session) on conflict do nothing;
  return not found;      -- true = this event was already applied
end $$;

create or replace function public._counts(p_session uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'serial',  (select count(*) from public.audit_serial_scans where session_id = p_session),
    'entries', (select count(*) from public.audit_non_serial_entries where session_id = p_session),
    'units',   (select count(*) from public.audit_serial_scans where session_id = p_session)
             + (select coalesce(sum(physical_qty), 0) from public.audit_non_serial_entries where session_id = p_session))
$$;
revoke execute on function public._session_for(uuid,boolean), public._replay(uuid,uuid), public._counts(uuid) from public, anon, authenticated;

-- ---------- context / start ------------------------------------------
create or replace function public.my_audit_context() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_store uuid := public.my_store_id(); st public.stores; cy public.audit_cycles; s public.audit_sessions; v_circle text;
begin
  if public.app_role() is distinct from 'STORE_USER' or v_store is null then
    raise exception 'You do not have permission to perform this action.' using errcode = '42501'; end if;
  select * into st from public.stores where id = v_store;
  select code into v_circle from public.circles where id = st.circle_id;
  select c.* into cy from public.audit_cycles c
    join public.audit_cycle_stores a on a.audit_cycle_id = c.id and a.store_id = v_store and a.active_upload_id is not null
   where c.status = 'ACTIVE' order by c.created_at desc limit 1;
  if found then
    select * into s from public.audit_sessions where audit_cycle_id = cy.id and store_id = v_store and status in ('IN_PROGRESS','LOCKED');
  end if;
  return jsonb_build_object(
    'store', jsonb_build_object('id', st.id, 'code', st.code, 'name', st.name, 'circle', v_circle),
    'cycle', case when cy.id is null then null else jsonb_build_object('id', cy.id, 'name', cy.name) end,
    'session', case when s.id is null then null else jsonb_build_object('id', s.id, 'version', s.version, 'status', s.status, 'submitted_at', s.submitted_at) end,
    'counts', case when s.id is null then null else public._counts(s.id) end);
end $$;

create or replace function public.start_audit() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_store uuid := public.my_store_id(); cy public.audit_cycles; v_up uuid; s public.audit_sessions;
begin
  if public.app_role() is distinct from 'STORE_USER' or v_store is null then
    raise exception 'You do not have permission to perform this action.' using errcode = '42501'; end if;
  select c.* into cy from public.audit_cycles c
    join public.audit_cycle_stores a on a.audit_cycle_id = c.id and a.store_id = v_store and a.active_upload_id is not null
   where c.status = 'ACTIVE' order by c.created_at desc limit 1;
  if cy.id is not null then
    select active_upload_id into v_up from public.audit_cycle_stores where audit_cycle_id = cy.id and store_id = v_store;
  end if;
  if cy.id is null then raise exception 'No audit is open for your store yet.' using errcode = 'P0001'; end if;
  select * into s from public.audit_sessions where audit_cycle_id = cy.id and store_id = v_store and status in ('IN_PROGRESS','LOCKED');
  if not found then
    insert into public.audit_sessions(audit_cycle_id, store_id, version, base_upload_id, started_by)
    values (cy.id, v_store, coalesce((select max(version) from public.audit_sessions where audit_cycle_id = cy.id and store_id = v_store), 0) + 1, v_up, auth.uid())
    returning * into s;
    perform public.log_event('AUDIT_STARTED', v_store, cy.id, s.id, s.id, jsonb_build_object('version', s.version));
  end if;
  return jsonb_build_object('session_id', s.id, 'status', s.status);
end $$;

-- ---------- serialized scanning --------------------------------------
create or replace function public.scan_serial(p_session uuid, p_serial text, p_event uuid default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s public.audit_sessions; v_sn text := upper(btrim(p_serial)); b public.base_stock;
begin
  s := public._session_for(p_session, true);
  if v_sn is null or v_sn = '' then raise exception 'Please scan or enter a serial number.' using errcode = 'P0001'; end if;
  if public._replay(p_event, p_session) then
    return jsonb_build_object('status', 'REPLAY', 'serial', v_sn, 'counts', public._counts(p_session)); end if;
  if exists (select 1 from public.audit_serial_scans where session_id = p_session and item_sno = v_sn) then
    perform public.log_event('SERIAL_DUPLICATE', s.store_id, s.audit_cycle_id, s.id, null, jsonb_build_object('serial', v_sn));
    return jsonb_build_object('status', 'DUPLICATE', 'serial', v_sn, 'counts', public._counts(p_session));
  end if;
  select * into b from public.base_stock where upload_id = s.base_upload_id and item_sno = v_sn;     -- this store's frozen base ONLY
  if found then
    insert into public.audit_serial_scans(session_id, audit_cycle_id, store_id, item_sno, item_code, is_unlisted, client_event_id)
    values (p_session, s.audit_cycle_id, s.store_id, v_sn, b.item_code, false, p_event);
    perform public.log_event('SERIAL_SCANNED', s.store_id, s.audit_cycle_id, s.id, null, jsonb_build_object('serial', v_sn, 'item_code', b.item_code));
    return jsonb_build_object('status', 'MATCHED', 'serial', v_sn, 'item_code', b.item_code, 'item_description', b.item_description,
      'inventory_status', b.inventory_status, 'item_uom', b.item_uom, 'item_quality', b.item_quality, 'counts', public._counts(p_session));
  end if;
  perform public.log_event('SERIAL_NOT_FOUND', s.store_id, s.audit_cycle_id, s.id, null, jsonb_build_object('serial', v_sn));
  return jsonb_build_object('status', 'NOT_FOUND', 'serial', v_sn, 'counts', public._counts(p_session));
end $$;

-- A serial not in this store's base: recorded as physical stock (reconciles as EXCESS). Never matched to another store.
create or replace function public.add_unlisted_serial(p_session uuid, p_serial text, p_item_code text, p_event uuid default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s public.audit_sessions; v_sn text := upper(btrim(p_serial)); v_code text := upper(btrim(p_item_code));
begin
  s := public._session_for(p_session, true);
  if v_sn is null or v_sn = '' then raise exception 'Please scan or enter a serial number.' using errcode = 'P0001'; end if;
  if v_code is null or v_code = '' then raise exception 'Please enter the Item Code for this physical serial.' using errcode = 'P0001'; end if;
  if public._replay(p_event, p_session) then
    return jsonb_build_object('status', 'REPLAY', 'serial', v_sn, 'counts', public._counts(p_session)); end if;
  if exists (select 1 from public.audit_serial_scans where session_id = p_session and item_sno = v_sn) then
    perform public.log_event('SERIAL_DUPLICATE', s.store_id, s.audit_cycle_id, s.id, null, jsonb_build_object('serial', v_sn));
    return jsonb_build_object('status', 'DUPLICATE', 'serial', v_sn, 'counts', public._counts(p_session));
  end if;
  insert into public.audit_serial_scans(session_id, audit_cycle_id, store_id, item_sno, item_code, is_unlisted, client_event_id)
  values (p_session, s.audit_cycle_id, s.store_id, v_sn, v_code,
          not exists (select 1 from public.base_stock where upload_id = s.base_upload_id and item_sno = v_sn), p_event);
  perform public.log_event('UNLISTED_SERIAL_ADDED', s.store_id, s.audit_cycle_id, s.id, null, jsonb_build_object('serial', v_sn, 'item_code', v_code));
  return jsonb_build_object('status', 'UNLISTED_ADDED', 'serial', v_sn, 'item_code', v_code, 'counts', public._counts(p_session));
end $$;

-- ---------- non-serialized counting (blind: no quantities ever returned) ----
create or replace function public.lookup_item(p_session uuid, p_code text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s public.audit_sessions; v text := upper(btrim(p_code)); v_opts jsonb; v_exact boolean := true; v_ser boolean;
begin
  s := public._session_for(p_session, false);
  if v is null or length(v) < 2 then return jsonb_build_object('options', '[]'::jsonb, 'exact', true, 'serialized_only', false); end if;
  select coalesce(jsonb_agg(x), '[]') into v_opts from (
    select item_code, inventory_status, item_quality, min(item_description) as item_description, min(item_uom) as item_uom
      from public.base_stock where upload_id = s.base_upload_id and item_sno is null and upper(item_code) = v
     group by item_code, inventory_status, item_quality limit 12) x;
  if jsonb_array_length(v_opts) = 0 then
    select exists (select 1 from public.base_stock where upload_id = s.base_upload_id and item_sno is not null and upper(item_code) = v) into v_ser;
    if v_ser then return jsonb_build_object('options', '[]'::jsonb, 'exact', true, 'serialized_only', true); end if;
    if length(v) >= 3 then
      v_exact := false;
      select coalesce(jsonb_agg(x), '[]') into v_opts from (
        select item_code, null::text as inventory_status, null::text as item_quality, min(item_description) as item_description, min(item_uom) as item_uom
          from public.base_stock where upload_id = s.base_upload_id and item_sno is null and starts_with(upper(item_code), v)
         group by item_code order by item_code limit 8) x;
    end if;
  end if;
  return jsonb_build_object('options', v_opts, 'exact', v_exact, 'serialized_only', false);
end $$;

create or replace function public.add_non_serial(p_session uuid, p_code text, p_status text, p_quality text, p_qty numeric, p_event uuid default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s public.audit_sessions; v_code text; v_in_base boolean; v_id uuid; v_total numeric;
begin
  s := public._session_for(p_session, true);
  if p_code is null or btrim(p_code) = '' then raise exception 'Please enter the Item Code.' using errcode = 'P0001'; end if;
  if p_qty is null or p_qty <= 0 then raise exception 'Please enter a quantity greater than zero.' using errcode = 'P0001'; end if;
  select item_code into v_code from public.base_stock where upload_id = s.base_upload_id and upper(item_code) = upper(btrim(p_code)) limit 1;
  v_in_base := v_code is not null; v_code := coalesce(v_code, upper(btrim(p_code)));
  if v_in_base and not exists (select 1 from public.base_stock where upload_id = s.base_upload_id and item_sno is null and item_code = v_code) then
    raise exception 'This item is serialized. Please scan its serial numbers instead.' using errcode = 'P0001'; end if;
  if public._replay(p_event, p_session) then
    return jsonb_build_object('status', 'REPLAY', 'item_code', v_code, 'counts', public._counts(p_session)); end if;
  insert into public.audit_non_serial_entries(session_id, audit_cycle_id, store_id, item_code, inventory_status, item_quality, physical_qty, client_event_id, created_by)
  values (p_session, s.audit_cycle_id, s.store_id, v_code, coalesce(btrim(p_status), ''), coalesce(btrim(p_quality), ''), p_qty, p_event, auth.uid())
  on conflict (session_id, item_code, inventory_status, item_quality)
  do update set physical_qty = public.audit_non_serial_entries.physical_qty + excluded.physical_qty, updated_at = now()
  returning id, physical_qty into v_id, v_total;
  perform public.log_event('NON_SERIAL_ADDED', s.store_id, s.audit_cycle_id, s.id, v_id, jsonb_build_object('item_code', v_code, 'added', p_qty, 'entry_total', v_total));
  return jsonb_build_object('status', 'ADDED', 'item_code', v_code, 'added', p_qty, 'entry_total', v_total, 'in_base', v_in_base, 'counts', public._counts(p_session));
end $$;

create or replace function public.edit_non_serial(p_id uuid, p_qty numeric) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare e public.audit_non_serial_entries; s public.audit_sessions;
begin
  select * into e from public.audit_non_serial_entries where id = p_id;
  if not found then raise exception 'Entry not found.' using errcode = 'P0002'; end if;
  s := public._session_for(e.session_id, true);
  if p_qty is null or p_qty <= 0 then raise exception 'Please enter a quantity greater than zero.' using errcode = 'P0001'; end if;
  update public.audit_non_serial_entries set physical_qty = p_qty, updated_at = now() where id = p_id;
  perform public.log_event('ENTRY_EDITED', s.store_id, s.audit_cycle_id, s.id, p_id, jsonb_build_object('item_code', e.item_code, 'old_qty', e.physical_qty, 'new_qty', p_qty));
  return jsonb_build_object('counts', public._counts(s.id));
end $$;

create or replace function public.remove_entry(p_kind text, p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s public.audit_sessions; v_sid uuid; v_meta jsonb;
begin
  if p_kind = 'serial' then
    select session_id, jsonb_build_object('serial', item_sno, 'item_code', item_code, 'unlisted', is_unlisted) into v_sid, v_meta from public.audit_serial_scans where id = p_id;
  elsif p_kind = 'nonserial' then
    select session_id, jsonb_build_object('item_code', item_code, 'qty', physical_qty) into v_sid, v_meta from public.audit_non_serial_entries where id = p_id;
  else raise exception 'Invalid entry.' using errcode = 'P0001'; end if;
  if v_sid is null then raise exception 'Entry not found.' using errcode = 'P0002'; end if;
  s := public._session_for(v_sid, true);
  if p_kind = 'serial' then delete from public.audit_serial_scans where id = p_id; else delete from public.audit_non_serial_entries where id = p_id; end if;
  perform public.log_event('ENTRY_REMOVED', s.store_id, s.audit_cycle_id, s.id, p_id, v_meta || jsonb_build_object('kind', p_kind));
  return jsonb_build_object('counts', public._counts(s.id));
end $$;

-- ---------- preview (paged; joins base only for descriptions) ---------
create or replace function public.session_preview(p_session uuid, p_type text default 'ALL', p_search text default null, p_offset int default 0, p_limit int default 50) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s public.audit_sessions; v_q text := nullif(btrim(coalesce(p_search, '')), ''); v jsonb;
begin
  s := public._session_for(p_session, false);
  with pv as (
    select 'serial'::text as kind, sc.id, sc.item_code, b.inventory_status, b.item_description, b.item_uom, 1::numeric as qty, b.item_quality, sc.item_sno, sc.is_unlisted, sc.scanned_at as at
      from public.audit_serial_scans sc left join public.base_stock b on b.upload_id = s.base_upload_id and b.item_sno = sc.item_sno where sc.session_id = p_session
    union all
    select 'nonserial', e.id, e.item_code, nullif(e.inventory_status, ''), d.item_description, d.item_uom, e.physical_qty, nullif(e.item_quality, ''), null, false, e.updated_at
      from public.audit_non_serial_entries e
      left join lateral (select item_description, item_uom from public.base_stock b where b.upload_id = s.base_upload_id and upper(b.item_code) = upper(e.item_code) limit 1) d on true
     where e.session_id = p_session),
  f as (select * from pv
         where (p_type = 'ALL' or (p_type = 'SERIAL' and kind = 'serial') or (p_type = 'NONSERIAL' and kind = 'nonserial'))
           and (v_q is null or item_code ilike '%' || v_q || '%' or coalesce(item_sno, '') ilike '%' || v_q || '%' or coalesce(item_description, '') ilike '%' || v_q || '%'))
  select jsonb_build_object('total', (select count(*) from f),
           'rows', (select coalesce(jsonb_agg(to_jsonb(x) order by x.at desc), '[]') from (select * from f order by at desc offset greatest(p_offset, 0) limit least(greatest(p_limit, 1), 200)) x),
           'counts', public._counts(p_session)) into v;
  return v;
end $$;

create or replace function public.log_preview(p_session uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare s public.audit_sessions;
begin s := public._session_for(p_session, false);
  perform public.log_event('PREVIEW_OPENED', s.store_id, s.audit_cycle_id, s.id, null, '{}'); end $$;

grant execute on function public.my_audit_context(), public.start_audit(), public.scan_serial(uuid,text,uuid), public.add_unlisted_serial(uuid,text,text,uuid),
  public.lookup_item(uuid,text), public.add_non_serial(uuid,text,text,text,numeric,uuid), public.edit_non_serial(uuid,numeric),
  public.remove_entry(text,uuid), public.session_preview(uuid,text,text,int,int), public.log_preview(uuid) to authenticated;
