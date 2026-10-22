-- =====================================================================
-- 32_shortage_revision.sql | Shortage revision workflow.
--   Stores explain genuine (non in-transit) shortage on the result page
--   with a remark CATEGORY (Issued to FE, S2W Cancelled, S2S, Virtual
--   Inward, Dummy SN, IT Error - admin-manageable), a quantity and an
--   optional reference. Admin / Circle Head review the remarks and
--   accept a quantity per remark group or per entry; only the ACCEPTED
--   quantity stops counting as genuine shortage - live, everywhere:
--   dashboard split, store result, ranking points / match / levels.
--   Pending remarks change nothing. The original audited numbers are
--   never overwritten; the revision lives in result_remarks (the table
--   from migration 16, extended here) next to them.
-- Run once in the Supabase SQL Editor, after 31_level_benchmarks.sql (safe to re-run).
-- =====================================================================

-- ---------- 1) new log entry types (audit_events has a fixed list) ----------
alter table public.audit_events drop constraint if exists audit_events_event_type_check;
alter table public.audit_events add constraint audit_events_event_type_check check (event_type in (
  'LOGIN','AUDIT_STARTED','SERIAL_SCANNED','SERIAL_DUPLICATE','SERIAL_NOT_FOUND','UNLISTED_SERIAL_ADDED',
  'NON_SERIAL_ADDED','ENTRY_REMOVED','ENTRY_EDITED','PREVIEW_OPENED','AUDIT_SUBMITTED','AUDIT_LOCKED',
  'AUDIT_REOPENED','BASE_UPLOADED','BASE_FROZEN','USER_APPROVED','USER_REJECTED','USER_STORE_CHANGED',
  'REPORT_EXPORTED','VALIDATION_FAILED','STORE_REPORT_NAME_SET','BASE_UPLOAD_WARNING','CYCLE_DELETED','USER_DELETED',
  'CYCLE_CLOSED','CYCLE_REOPENED','SHORTAGE_REMARK_SAVED','SHORTAGE_REVIEWED'));

-- ---------- 2) remark categories (admin-manageable) ----------
create table if not exists public.remark_categories (
  id           uuid primary key default gen_random_uuid(),
  name         text not null unique,
  ref_label    text not null default 'Reference',
  ref_required boolean not null default false,
  sort         int not null default 0,
  active       boolean not null default true,
  created_at   timestamptz not null default now()
);
alter table public.remark_categories enable row level security;
drop policy if exists remark_categories_read on public.remark_categories;
create policy remark_categories_read on public.remark_categories for select to authenticated using (true);
revoke all on public.remark_categories from anon, authenticated;
grant select on public.remark_categories to authenticated;

insert into public.remark_categories(name, ref_label, ref_required, sort) values
  ('Issued to FE',   'FE name / slip no.',        true,  1),
  ('S2W Cancelled',  'S2W order no.',             true,  2),
  ('S2S',            'S2S document / order no.',  true,  3),
  ('Virtual Inward', 'Challan / inward no.',      false, 4),
  ('Dummy SN',       'Actual SN (if known)',      false, 5),
  ('IT Error',       'Ticket no.',                true,  6)
on conflict (name) do nothing;

-- ---------- 3) structured fields on result_remarks ----------
alter table public.result_remarks
  add column if not exists category_id  uuid references public.remark_categories(id),
  add column if not exists reference    text,
  add column if not exists qty          numeric(14,2),
  add column if not exists status       text not null default 'PENDING',
  add column if not exists accepted_qty numeric(14,2),
  add column if not exists reviewed_by  uuid references public.profiles(id) on delete set null,
  add column if not exists reviewed_at  timestamptz,
  add column if not exists review_note  text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'result_remarks_status_check') then
    alter table public.result_remarks add constraint result_remarks_status_check check (status in ('PENDING','REVIEWED'));
  end if;
end $$;
-- the note text may now be empty (a category can speak for itself); keep the 500-char cap
alter table public.result_remarks drop constraint if exists result_remarks_remark_check;
alter table public.result_remarks drop constraint if exists result_remarks_remark_len;
alter table public.result_remarks add constraint result_remarks_remark_len check (char_length(remark) <= 500);

-- ---------- 4) category RPCs ----------
create or replace function public.remark_categories_list() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'ref_label', ref_label,
      'ref_required', ref_required, 'sort', sort, 'active', active) order by sort, name), '[]'::jsonb)
    from public.remark_categories $$;
revoke execute on function public.remark_categories_list() from public, anon;
grant execute on function public.remark_categories_list() to authenticated;

create or replace function public.admin_remark_category_save(p_id uuid, p_name text, p_ref_label text, p_ref_required boolean, p_sort int, p_active boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if not public.is_admin() then raise exception 'You do not have permission to perform this action.' using errcode = '42501'; end if;
  if btrim(coalesce(p_name, '')) = '' then raise exception 'Category name is required.' using errcode = 'P0001'; end if;
  if p_id is null then
    insert into public.remark_categories(name, ref_label, ref_required, sort, active)
    values (btrim(p_name), coalesce(nullif(btrim(p_ref_label), ''), 'Reference'), coalesce(p_ref_required, false), coalesce(p_sort, 0), coalesce(p_active, true))
    returning id into v_id;
  else
    update public.remark_categories set name = btrim(p_name), ref_label = coalesce(nullif(btrim(p_ref_label), ''), 'Reference'),
      ref_required = coalesce(p_ref_required, false), sort = coalesce(p_sort, 0), active = coalesce(p_active, true)
     where id = p_id returning id into v_id;
    if v_id is null then raise exception 'Category not found.' using errcode = 'P0002'; end if;
  end if;
  return jsonb_build_object('id', v_id);
end $$;
revoke execute on function public.admin_remark_category_save(uuid, text, text, boolean, int, boolean) from public, anon;
grant execute on function public.admin_remark_category_save(uuid, text, text, boolean, int, boolean) to authenticated;

-- ---------- 5) store: save / delete a structured remark ----------
create or replace function public.save_shortage_remark(p_session uuid, p_item_code text, p_status text, p_quality text, p_sno text,
  p_category uuid, p_reference text, p_qty numeric, p_remark text) returns void
language plpgsql security definer set search_path = '' as $$
declare s public.audit_sessions; v_short numeric; v_ist text; v_cat public.remark_categories;
  v_ref text := btrim(coalesce(p_reference, '')); v_note text := btrim(coalesce(p_remark, '')); v_eid uuid;
  v_st text := coalesce(p_status, ''); v_q text := coalesce(p_quality, ''); v_sn text := coalesce(p_sno, '');
begin
  s := public._session_for(p_session, false);                      -- store users only, own store
  if s.status <> 'LOCKED' then raise exception 'Remarks can be added once the audit is submitted, on the current result.' using errcode = 'P0001'; end if;
  select short_qty, coalesce(inventory_status, '') into v_short, v_ist from public.reconciliation_results x
   where x.session_id = s.id and x.result = 'SHORT' and x.item_code = p_item_code
     and coalesce(x.inventory_status, '') = v_st and coalesce(x.item_quality, '') = v_q and coalesce(x.item_sno, '') = v_sn;
  if v_short is null then raise exception 'Remarks can only be added to short items.' using errcode = 'P0001'; end if;
  if v_ist ilike '%transit%' then raise exception 'In-transit shortage is already excluded from your genuine shortage.' using errcode = 'P0001'; end if;
  if p_category is not null then
    select * into v_cat from public.remark_categories where id = p_category;
    if not found or not v_cat.active then raise exception 'Please choose a valid remark category.' using errcode = 'P0001'; end if;
    if v_cat.ref_required and v_ref = '' then raise exception ('Reference is required for ' || v_cat.name || ' (' || v_cat.ref_label || ').') using errcode = 'P0001'; end if;
  elsif v_note = '' then
    raise exception 'Pick a remark category or write a remark.' using errcode = 'P0001'; end if;
  if char_length(v_note) > 500 then raise exception 'Remarks can be at most 500 characters.' using errcode = 'P0001'; end if;
  if p_qty is not null and (p_qty <= 0 or p_qty > v_short) then raise exception 'Quantity must be between 1 and the short quantity.' using errcode = 'P0001'; end if;
  if exists (select 1 from public.result_remarks where store_id = s.store_id and audit_cycle_id = s.audit_cycle_id
      and item_code = p_item_code and inventory_status = v_st and item_quality = v_q and item_sno = v_sn and status = 'REVIEWED') then
    raise exception 'This remark is already reviewed and cannot be changed.' using errcode = 'P0001'; end if;
  insert into public.result_remarks(store_id, audit_cycle_id, item_code, inventory_status, item_quality, item_sno, remark,
      category_id, reference, qty, status, accepted_qty, reviewed_by, reviewed_at, updated_by)
  values (s.store_id, s.audit_cycle_id, p_item_code, v_st, v_q, v_sn, v_note,
      p_category, nullif(v_ref, ''), coalesce(p_qty, v_short), 'PENDING', null, null, null, auth.uid())
  on conflict (store_id, audit_cycle_id, item_code, inventory_status, item_quality, item_sno)
  do update set remark = excluded.remark, category_id = excluded.category_id, reference = excluded.reference,
      qty = excluded.qty, status = 'PENDING', accepted_qty = null, reviewed_by = null, reviewed_at = null,
      updated_by = excluded.updated_by, updated_at = now()
  returning id into v_eid;
  perform public.log_event('SHORTAGE_REMARK_SAVED', s.store_id, s.audit_cycle_id, s.id, v_eid,
    jsonb_build_object('item_code', p_item_code, 'category_id', p_category, 'qty', coalesce(p_qty, v_short)));
end $$;
revoke execute on function public.save_shortage_remark(uuid, text, text, text, text, uuid, text, numeric, text) from public, anon;
grant execute on function public.save_shortage_remark(uuid, text, text, text, text, uuid, text, numeric, text) to authenticated;

create or replace function public.delete_shortage_remark(p_session uuid, p_item_code text, p_status text, p_quality text, p_sno text) returns void
language plpgsql security definer set search_path = '' as $$
declare s public.audit_sessions; v_eid uuid;
  v_st text := coalesce(p_status, ''); v_q text := coalesce(p_quality, ''); v_sn text := coalesce(p_sno, '');
begin
  s := public._session_for(p_session, false);
  delete from public.result_remarks where store_id = s.store_id and audit_cycle_id = s.audit_cycle_id
    and item_code = p_item_code and inventory_status = v_st and item_quality = v_q and item_sno = v_sn and status = 'PENDING'
  returning id into v_eid;
  if v_eid is null then raise exception 'Nothing to remove - a reviewed remark is locked.' using errcode = 'P0001'; end if;
  perform public.log_event('SHORTAGE_REMARK_SAVED', s.store_id, s.audit_cycle_id, s.id, v_eid,
    jsonb_build_object('item_code', p_item_code, 'deleted', true));
end $$;
revoke execute on function public.delete_shortage_remark(uuid, text, text, text, text) from public, anon;
grant execute on function public.delete_shortage_remark(uuid, text, text, text, text) to authenticated;

-- ---------- 6) staff: review queue / entries / decisions ----------
create or replace function public.review_queue(p_cycle uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v jsonb;
begin
  if public.app_role() not in ('ADMIN','CIRCLE_HEAD') then
    raise exception 'You do not have permission to perform this action.' using errcode = '42501'; end if;
  with latest as (
    select distinct on (s.store_id) s.id as session_id, s.store_id
      from public.audit_sessions s
     where s.audit_cycle_id = p_cycle and s.status = 'LOCKED'
       and s.store_id in (select store_id from public._scope())
     order by s.store_id, s.version desc
  ), rows_g as (
    select l.store_id, l.session_id, r.item_code, coalesce(r.inventory_status, '') as ist,
           coalesce(r.item_quality, '') as iq, coalesce(r.item_sno, '') as sno, r.short_qty
      from latest l join public.reconciliation_results r on r.session_id = l.session_id
     where r.result = 'SHORT' and not (coalesce(r.inventory_status, '') ilike '%transit%')
  ), ent as (
    select g.store_id, rr.category_id,
           least(coalesce(rr.qty, g.short_qty), g.short_qty) as eff_qty,
           case when rr.status = 'REVIEWED' then least(coalesce(rr.accepted_qty, 0), g.short_qty) else 0 end as acc_qty,
           rr.status
      from rows_g g
      join public.result_remarks rr on rr.store_id = g.store_id and rr.audit_cycle_id = p_cycle
       and rr.item_code = g.item_code and rr.inventory_status = g.ist and rr.item_quality = g.iq and rr.item_sno = g.sno
  ), per_store as (
    select l.store_id, l.session_id,
           (select coalesce(sum(short_qty), 0) from rows_g g where g.store_id = l.store_id) as reported,
           (select coalesce(sum(eff_qty), 0) from ent e where e.store_id = l.store_id) as claimed,
           (select coalesce(sum(acc_qty), 0) from ent e where e.store_id = l.store_id) as accepted,
           (select count(*)::int from ent e where e.store_id = l.store_id and e.status = 'PENDING') as pending_n,
           (select count(*)::int from ent e where e.store_id = l.store_id) as entries_n
      from latest l
  ), grp as (
    select e.store_id, e.category_id, coalesce(sum(e.eff_qty), 0) as claimed, coalesce(sum(e.acc_qty), 0) as accepted,
           count(*)::int as entries_n, count(*) filter (where e.status = 'PENDING')::int as pending_n
      from ent e group by e.store_id, e.category_id
  )
  select coalesce(jsonb_agg(x order by x->>'circle', x->>'code'), '[]'::jsonb) into v from (
    select jsonb_build_object(
      'session_id', p.session_id, 'store_id', p.store_id, 'code', st.code, 'name', st.name, 'circle', ci.code,
      'reported', p.reported, 'claimed', p.claimed, 'accepted', p.accepted,
      'revised', greatest(p.reported - p.accepted, 0), 'pending_entries', p.pending_n, 'entries', p.entries_n,
      'groups', (select coalesce(jsonb_agg(jsonb_build_object('category_id', g.category_id, 'category', coalesce(cat.name, 'Free text only'),
                    'claimed', g.claimed, 'accepted', g.accepted, 'entries', g.entries_n, 'pending', g.pending_n)
                    order by cat.sort nulls last, coalesce(cat.name, 'Free text only')), '[]'::jsonb)
                   from grp g left join public.remark_categories cat on cat.id = g.category_id where g.store_id = p.store_id)
    ) as x
    from per_store p join public.stores st on st.id = p.store_id join public.circles ci on ci.id = st.circle_id
    where p.reported > 0 or p.entries_n > 0
  ) t;
  return jsonb_build_object('stores', coalesce(v, '[]'::jsonb));
end $$;
revoke execute on function public.review_queue(uuid) from public, anon;
grant execute on function public.review_queue(uuid) to authenticated;

create or replace function public.review_entries(p_session uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_store uuid; v_cycle uuid; v_ls uuid; v jsonb;
begin
  if public.app_role() not in ('ADMIN','CIRCLE_HEAD') then
    raise exception 'You do not have permission to perform this action.' using errcode = '42501'; end if;
  select store_id, audit_cycle_id into v_store, v_cycle from public.audit_sessions where id = p_session;
  if v_store is null then raise exception 'Session not found.' using errcode = 'P0002'; end if;
  if not public.can_see_store(v_store) then
    raise exception 'You do not have permission to perform this action.' using errcode = '42501'; end if;
  select id into v_ls from public.audit_sessions
   where audit_cycle_id = v_cycle and store_id = v_store and status = 'LOCKED' order by version desc limit 1;
  select coalesce(jsonb_agg(e order by e->>'category', e->>'item_code', e->>'item_sno'), '[]'::jsonb) into v from (
    select jsonb_build_object('id', rr.id, 'item_code', r.item_code, 'inventory_status', r.inventory_status, 'item_quality', r.item_quality,
      'item_sno', r.item_sno, 'is_serialized', r.is_serialized, 'short_qty', r.short_qty,
      'category_id', rr.category_id, 'category', cat.name, 'qty', least(coalesce(rr.qty, r.short_qty), r.short_qty),
      'reference', rr.reference, 'remark', rr.remark, 'status', rr.status, 'accepted_qty', rr.accepted_qty,
      'updated_at', rr.updated_at) as e
    from public.reconciliation_results r
    join public.result_remarks rr on rr.store_id = v_store and rr.audit_cycle_id = v_cycle
     and rr.item_code = r.item_code and rr.inventory_status = coalesce(r.inventory_status, '')
     and rr.item_quality = coalesce(r.item_quality, '') and rr.item_sno = coalesce(r.item_sno, '')
    left join public.remark_categories cat on cat.id = rr.category_id
    where r.session_id = v_ls and r.result = 'SHORT' and not (coalesce(r.inventory_status, '') ilike '%transit%')
  ) t;
  return jsonb_build_object('entries', coalesce(v, '[]'::jsonb));
end $$;
revoke execute on function public.review_entries(uuid) from public, anon;
grant execute on function public.review_entries(uuid) to authenticated;

create or replace function public.review_remark_group(p_session uuid, p_category uuid, p_accepted_total numeric) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_store uuid; v_cycle uuid; v_ls uuid; e record;
  v_rem numeric := greatest(coalesce(p_accepted_total, 0), 0); v_given numeric := 0; v_give numeric;
begin
  if public.app_role() not in ('ADMIN','CIRCLE_HEAD') then
    raise exception 'You do not have permission to perform this action.' using errcode = '42501'; end if;
  select store_id, audit_cycle_id into v_store, v_cycle from public.audit_sessions where id = p_session;
  if v_store is null then raise exception 'Session not found.' using errcode = 'P0002'; end if;
  if not public.can_see_store(v_store) then
    raise exception 'You do not have permission to perform this action.' using errcode = '42501'; end if;
  select id into v_ls from public.audit_sessions
   where audit_cycle_id = v_cycle and store_id = v_store and status = 'LOCKED' order by version desc limit 1;
  if v_ls is null then raise exception 'No submitted audit for this store in this cycle.' using errcode = 'P0001'; end if;
  for e in
    select rr.id, least(coalesce(rr.qty, r.short_qty), r.short_qty) as cap
      from public.reconciliation_results r
      join public.result_remarks rr on rr.store_id = v_store and rr.audit_cycle_id = v_cycle
       and rr.item_code = r.item_code and rr.inventory_status = coalesce(r.inventory_status, '')
       and rr.item_quality = coalesce(r.item_quality, '') and rr.item_sno = coalesce(r.item_sno, '')
     where r.session_id = v_ls and r.result = 'SHORT' and not (coalesce(r.inventory_status, '') ilike '%transit%')
       and rr.category_id is not distinct from p_category
     order by rr.updated_at, rr.id
  loop
    v_give := least(e.cap, v_rem);
    update public.result_remarks set accepted_qty = v_give, status = 'REVIEWED',
      reviewed_by = auth.uid(), reviewed_at = now() where id = e.id;
    v_rem := v_rem - v_give; v_given := v_given + v_give;
  end loop;
  perform public.log_event('SHORTAGE_REVIEWED', v_store, v_cycle, v_ls, null,
    jsonb_build_object('category_id', p_category, 'accepted_total', v_given));
  return jsonb_build_object('accepted', v_given);
end $$;
revoke execute on function public.review_remark_group(uuid, uuid, numeric) from public, anon;
grant execute on function public.review_remark_group(uuid, uuid, numeric) to authenticated;

create or replace function public.review_remark_entry(p_remark uuid, p_accepted_qty numeric) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_store uuid; v_cycle uuid; v_ls uuid; v_cap numeric; v_acc numeric;
begin
  if public.app_role() not in ('ADMIN','CIRCLE_HEAD') then
    raise exception 'You do not have permission to perform this action.' using errcode = '42501'; end if;
  select store_id, audit_cycle_id into v_store, v_cycle from public.result_remarks where id = p_remark;
  if v_store is null then raise exception 'Remark not found.' using errcode = 'P0002'; end if;
  if not public.can_see_store(v_store) then
    raise exception 'You do not have permission to perform this action.' using errcode = '42501'; end if;
  select id into v_ls from public.audit_sessions
   where audit_cycle_id = v_cycle and store_id = v_store and status = 'LOCKED' order by version desc limit 1;
  select least(coalesce(rr.qty, r.short_qty), r.short_qty) into v_cap
    from public.result_remarks rr
    join public.reconciliation_results r on r.session_id = v_ls and r.result = 'SHORT'
     and rr.item_code = r.item_code and rr.inventory_status = coalesce(r.inventory_status, '')
     and rr.item_quality = coalesce(r.item_quality, '') and rr.item_sno = coalesce(r.item_sno, '')
   where rr.id = p_remark and not (coalesce(r.inventory_status, '') ilike '%transit%');
  if v_cap is null then raise exception 'This remark no longer matches a short item.' using errcode = 'P0001'; end if;
  v_acc := greatest(0, least(coalesce(p_accepted_qty, 0), v_cap));
  update public.result_remarks set accepted_qty = v_acc, status = 'REVIEWED',
    reviewed_by = auth.uid(), reviewed_at = now() where id = p_remark;
  perform public.log_event('SHORTAGE_REVIEWED', v_store, v_cycle, v_ls, p_remark,
    jsonb_build_object('accepted_qty', v_acc));
  return jsonb_build_object('accepted', v_acc);
end $$;
revoke execute on function public.review_remark_entry(uuid, numeric) from public, anon;
grant execute on function public.review_remark_entry(uuid, numeric) to authenticated;

-- ---------- 7) ranking: accepted revision counts as accounted ----------
drop function if exists public._circle_rank(timestamptz, timestamptz);
drop function if exists public._store_rank(timestamptz, timestamptz);
create or replace function public._store_rank(p_from timestamptz, p_to timestamptz) returns table(
  store_id uuid, code text, name text, circle_id uuid, circle text, cycles_held int, cycles_done int,
  expected numeric, matched numeric, short numeric, short_transit numeric, short_other numeric, short_explained numeric, counted_short_pct numeric, points numeric,
  match_rate numeric, late_count int, level text,
  pan_rank int, pan_total int, circle_rank int, circle_total int)
language sql stable security definer set search_path = '' as $$
  with cyc as (
    select s.id as sid, ls.id is not null as done, ls.expected_units as ex, ls.matched_units as ma, ls.short_units as sh, coalesce(tr.q, 0) as trs,
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
           coalesce(a.ex, 0) as ex, coalesce(a.ma, 0) as ma, coalesce(a.sh, 0) as sh, coalesce(a.trs, 0) as trs, coalesce(a.acc, 0) as acc,
           greatest(coalesce(a.sh, 0) - coalesce(a.trs, 0) - coalesce(a.acc, 0), 0) as oth,
           case when coalesce(a.ex, 0) > 0 then round(100 * greatest(coalesce(a.sh, 0) - coalesce(a.trs, 0) - coalesce(a.acc, 0), 0) / a.ex, 4) end as cpct,
           coalesce(a.pts, 0) as pts,
           coalesce(a.late_n, 0) as late_n,
           case when coalesce(a.ex, 0) - coalesce(a.trs, 0) > 0 then round(100 * (a.ma + a.acc) / (a.ex - a.trs), 4) end as mrate
      from public.stores s join public.circles c on c.id = s.circle_id left join agg a on a.sid = s.id
     where s.active
  )
  select id, code, name, circle_id, circle, held::int, done_n::int, ex, ma, sh, trs, oth, acc, cpct, pts, mrate, late_n::int,
         public._store_level(done_n::int, held::int, mrate, cpct, late_n::int),
         (dense_rank() over (order by pts desc, cpct asc nulls last))::int, (count(*) over ())::int,
         (dense_rank() over (partition by circle_id order by pts desc, cpct asc nulls last))::int, (count(*) over (partition by circle_id))::int
    from base
$$;

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
    'match_rate', r.match_rate, 'level', r.level, 'late_count', r.late_count,
    'level_points', (select coalesce(jsonb_object_agg(t.level, t.mp), '{}'::jsonb)
                       from (select level, min(points) as mp from public._store_rank(p_from, p_to) where cycles_done > 0 group by level) t),
    'pan_rank', r.pan_rank, 'pan_total', r.pan_total, 'circle_rank', r.circle_rank, 'circle_total', r.circle_total,
    'cycles', (select coalesce(jsonb_agg(jsonb_build_object('name', c.name, 'status', c.status, 'done', ls.id is not null,
          'short', ls.short_units, 'short_transit', coalesce(tr.q, 0), 'short_other', (ls.short_units - coalesce(tr.q, 0)) - coalesce(rv.q, 0),
          'short_other_reported', ls.short_units - coalesce(tr.q, 0), 'explained', coalesce(rv.q, 0),
          'match_rate', case when ls.id is not null and coalesce(ls.expected_units - coalesce(tr.q, 0), 0) > 0 then round(100 * (ls.matched_units + coalesce(rv.q, 0)) / (ls.expected_units - coalesce(tr.q, 0)), 2) end,
          'points', case when ls.id is not null then public._rank_points(ls.expected_units - coalesce(tr.q, 0), ls.matched_units + coalesce(rv.q, 0)) else 0 end) order by c.created_at desc), '[]'::jsonb)
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
       where c.status <> 'DRAFT'
         and c.created_at >= coalesce(p_from, '-infinity'::timestamptz) and c.created_at < coalesce(p_to, 'infinity'::timestamptz)
         and (ls.id is not null or (c.status <> 'ACTIVE' and c.created_at >= (select created_at from public.stores where id = v_store)))));
end $$;

revoke execute on function public._store_rank(timestamptz, timestamptz), public._circle_rank(timestamptz, timestamptz) from public, anon, authenticated;
revoke execute on function public.rank_my_store(timestamptz, timestamptz) from public, anon;
grant execute on function public.rank_my_store(timestamptz, timestamptz) to authenticated;

-- ---------- 8) dashboard split: explained + revised genuine ----------
create or replace function public.dash_shortage_breakdown(p_cycle uuid, p_circles text[] default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v jsonb;
begin
  if public.app_role() not in ('ADMIN','CIRCLE_HEAD') then
    raise exception 'You do not have permission to perform this action.' using errcode = '42501';
  end if;
  with latest as (
    select distinct on (s.store_id) s.id, s.status
      from public.audit_sessions s
     where s.audit_cycle_id = p_cycle
       and s.status in ('IN_PROGRESS','LOCKED')
       and s.store_id in (select store_id from public._scope())
       and (p_circles is null or exists (
             select 1 from public.stores st
               join public.circles c on c.id = st.circle_id
              where st.id = s.store_id and c.code = any(p_circles)))
     order by s.store_id, s.version desc
  ), base as (
    select r.* from public.reconciliation_results r
      join latest l on l.id = r.session_id and l.status = 'LOCKED'
  ), expl as (
    select coalesce(sum(least(rr.accepted_qty, b.short_qty)) filter (where coalesce(b.is_serialized, false)), 0) as e_ser,
           coalesce(sum(least(rr.accepted_qty, b.short_qty)) filter (where not coalesce(b.is_serialized, false)), 0) as e_non
      from base b
      join public.result_remarks rr on rr.store_id = b.store_id and rr.audit_cycle_id = b.audit_cycle_id
       and rr.item_code = b.item_code and rr.inventory_status = coalesce(b.inventory_status, '')
       and rr.item_quality = coalesce(b.item_quality, '') and rr.item_sno = coalesce(b.item_sno, '')
     where b.result = 'SHORT' and not (coalesce(b.inventory_status, '') ilike '%transit%')
       and rr.status = 'REVIEWED' and coalesce(rr.accepted_qty, 0) > 0
  ), agg as (
    select coalesce(sum(short_qty) filter (where result = 'SHORT' and inventory_status ilike '%transit%'), 0) as t,
           coalesce(sum(short_qty) filter (where result = 'SHORT' and coalesce(is_serialized, false)
              and not (coalesce(inventory_status, '') ilike '%transit%')), 0) as ser,
           coalesce(sum(short_qty) filter (where result = 'SHORT' and not coalesce(is_serialized, false)
              and not (coalesce(inventory_status, '') ilike '%transit%')), 0) as non
      from base
  )
  select jsonb_build_object(
    'short_transit', agg.t, 'ser_short', agg.ser, 'non_short', agg.non,
    'short_explained', (select e_ser + e_non from expl),
    'ser_short_rev', agg.ser - (select e_ser from expl),
    'non_short_rev', agg.non - (select e_non from expl)
  ) into v from agg;
  return v;
end $$;
revoke execute on function public.dash_shortage_breakdown(uuid, text[]) from public, anon;
grant execute on function public.dash_shortage_breakdown(uuid, text[]) to authenticated;
