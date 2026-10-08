-- =====================================================================
-- Shadowfax Airtel Store Audit Tracker  |  PHASE 1: schema + RLS + auth
-- Run in the Supabase SQL editor (as postgres). Safe to run once on a fresh project.
--
-- SECURITY MODEL (read this first)
--  * The browser never writes audit data directly. Scans, entries, session start,
--    submit, reopen all go through SECURITY DEFINER RPCs (Phases 3-4) that derive
--    user / store / cycle from auth.uid(), never from client input.
--  * STORE_USER has NO policy on base_stock at all -> the table is invisible to them.
--  * Locked audits are immutable: a trigger rejects any change to scans/entries
--    unless the parent session is IN_PROGRESS. Reopen = new version, v1 preserved.
--  * audit_events is append-only (trigger blocks UPDATE/DELETE).
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------- enums ----------------------------------------------------
create type public.user_role       as enum ('ADMIN','CIRCLE_HEAD','STORE_USER');
create type public.approval_status as enum ('PENDING','APPROVED','REJECTED');
create type public.cycle_status    as enum ('DRAFT','ACTIVE','COMPLETED','ARCHIVED');
create type public.upload_status   as enum ('DRAFT','FROZEN','SUPERSEDED','DISCARDED');
create type public.session_status  as enum ('IN_PROGRESS','LOCKED','REOPENED');

-- ---------- core reference tables ------------------------------------
create table public.circles (
  id         uuid primary key default gen_random_uuid(),
  code       text not null unique,            -- e.g. RAJ
  name       text not null,
  created_at timestamptz not null default now()
);

create table public.stores (
  id         uuid primary key default gen_random_uuid(),
  code       text not null unique,            -- must equal Substore_Name in the stock report, e.g. SFX_JODHPUR
  name       text not null,
  circle_id  uuid not null references public.circles(id),
  active     boolean not null default true,
  created_at timestamptz not null default now()
);
create index on public.stores(circle_id);

create table public.profiles (
  id                 uuid primary key references auth.users(id) on delete cascade,
  full_name          text not null,
  employee_id        text,
  email              text,
  mobile             text,
  role               public.user_role not null default 'STORE_USER',
  status             public.approval_status not null default 'PENDING',
  requested_store_id uuid references public.stores(id),
  reviewed_by        uuid references public.profiles(id),
  reviewed_at        timestamptz,
  reject_reason      text,
  created_at         timestamptz not null default now()
);
create index on public.profiles(status);

create table public.user_store_assignments (       -- one store per store user, ever
  user_id     uuid primary key references public.profiles(id) on delete cascade,
  store_id    uuid not null references public.stores(id),
  assigned_by uuid references public.profiles(id),
  assigned_at timestamptz not null default now()
);
create index on public.user_store_assignments(store_id);

create table public.circle_head_assignments (
  user_id   uuid not null references public.profiles(id) on delete cascade,
  circle_id uuid not null references public.circles(id) on delete cascade,
  primary key (user_id, circle_id)
);

-- ---------- audit cycles & base stock --------------------------------
create table public.audit_cycles (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,            -- e.g. OCT-2026
  start_date date not null,
  end_date   date not null,
  status     public.cycle_status not null default 'DRAFT',
  created_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now(),
  check (end_date >= start_date)
);

create table public.base_stock_uploads (           -- one row per (cycle, store, version)
  id                  uuid primary key default gen_random_uuid(),
  audit_cycle_id      uuid not null references public.audit_cycles(id) on delete cascade,
  store_id            uuid not null references public.stores(id),
  version             int  not null default 1,
  status              public.upload_status not null default 'DRAFT',
  source_file_name    text,
  source_file_path    text,                      -- private bucket: base-stock-files/<cycle>/<store>/<upload>.xlsx
  rows_uploaded       int  not null default 0,
  rows_valid          int  not null default 0,
  serialized_count    int  not null default 0,
  non_serialized_count int not null default 0,
  error_summary       jsonb not null default '{}',
  uploaded_by         uuid references public.profiles(id) default auth.uid(),
  uploaded_at         timestamptz not null default now(),
  frozen_by           uuid references public.profiles(id),
  frozen_at           timestamptz,
  unique (audit_cycle_id, store_id, version)
);
create unique index one_frozen_base_per_store on public.base_stock_uploads(audit_cycle_id, store_id) where status = 'FROZEN';
create unique index one_draft_base_per_store  on public.base_stock_uploads(audit_cycle_id, store_id) where status = 'DRAFT';

create table public.audit_cycle_stores (           -- which stores take part in a cycle
  id               uuid primary key default gen_random_uuid(),
  audit_cycle_id   uuid not null references public.audit_cycles(id) on delete cascade,
  store_id         uuid not null references public.stores(id),
  active_upload_id uuid references public.base_stock_uploads(id),   -- set ONLY by freeze RPC; non-null = base frozen
  frozen_at        timestamptz,
  unique (audit_cycle_id, store_id)
);
create index on public.audit_cycle_stores(store_id);

create table public.base_stock (
  id               uuid primary key default gen_random_uuid(),
  upload_id        uuid not null references public.base_stock_uploads(id) on delete cascade,
  audit_cycle_id   uuid not null references public.audit_cycles(id),
  store_id         uuid not null references public.stores(id),
  item_code        text not null check (btrim(item_code) <> ''),
  inventory_status text,
  item_description text,
  item_uom         text,      -- NOTE: not in your original 6-field list, but needed for UI (Nos/Mtr). See notes.
  item_qnty        numeric(14,2) not null check (item_qnty >= 0),   -- numeric: Meter items are fractional
  item_quality     text,
  item_sno         text check (item_sno is null or (item_sno <> '' and item_sno = upper(btrim(item_sno)))),
  is_serialized    boolean generated always as (item_sno is not null) stored,
  created_at       timestamptz not null default now()
);
create index base_stock_sno_idx  on public.base_stock(audit_cycle_id, store_id, item_sno);
create index base_stock_code_idx on public.base_stock(audit_cycle_id, store_id, item_code);
create unique index base_stock_serial_uniq on public.base_stock(upload_id, item_sno) where item_sno is not null;

-- ---------- audit sessions & physical counts -------------------------
create table public.audit_sessions (               -- one row per (cycle, store, version)
  id                  uuid primary key default gen_random_uuid(),
  audit_cycle_id      uuid not null references public.audit_cycles(id),
  store_id            uuid not null references public.stores(id),
  version             int  not null default 1,
  status              public.session_status not null default 'IN_PROGRESS',
  base_upload_id      uuid not null references public.base_stock_uploads(id),  -- base this audit is measured against
  started_by          uuid not null references public.profiles(id),
  started_at          timestamptz not null default now(),
  submitted_by        uuid references public.profiles(id),
  submitted_at        timestamptz,
  reopened_from       uuid references public.audit_sessions(id),
  reopened_by         uuid references public.profiles(id),
  reopened_at         timestamptz,
  reopen_reason       text,
  unique (audit_cycle_id, store_id, version)
);
create unique index one_live_session_per_store on public.audit_sessions(audit_cycle_id, store_id) where status in ('IN_PROGRESS','LOCKED');

create table public.audit_serial_scans (
  id              uuid primary key default gen_random_uuid(),
  session_id      uuid not null references public.audit_sessions(id),
  audit_cycle_id  uuid not null references public.audit_cycles(id),   -- overwritten from session by trigger
  store_id        uuid not null references public.stores(id),         -- overwritten from session by trigger
  item_sno        text not null check (item_sno <> '' and item_sno = upper(btrim(item_sno))),
  item_code       text not null,
  is_unlisted     boolean not null default false,    -- true = not in this store's base -> reconciles as EXCESS
  client_event_id uuid unique,                       -- idempotency key for offline sync
  scanned_by      uuid not null references public.profiles(id) default auth.uid(),
  scanned_at      timestamptz not null default now(),
  client_scanned_at timestamptz,
  unique (session_id, item_sno)                      -- duplicate scan can never add a second unit
);

create table public.audit_non_serial_entries (
  id               uuid primary key default gen_random_uuid(),
  session_id       uuid not null references public.audit_sessions(id),
  audit_cycle_id   uuid not null references public.audit_cycles(id),
  store_id         uuid not null references public.stores(id),
  item_code        text not null,
  inventory_status text not null default '',
  item_quality     text not null default '',
  physical_qty     numeric(14,2) not null check (physical_qty > 0),
  client_event_id  uuid unique,
  created_by       uuid not null references public.profiles(id) default auth.uid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (session_id, item_code, inventory_status, item_quality)
);

create table public.reconciliation_results (
  id               uuid primary key default gen_random_uuid(),
  session_id       uuid not null references public.audit_sessions(id),
  audit_cycle_id   uuid not null references public.audit_cycles(id),
  store_id         uuid not null references public.stores(id),
  item_code        text not null,
  inventory_status text,
  item_description text,
  item_uom         text,
  item_quality     text,
  item_sno         text,
  is_serialized    boolean not null,
  is_unlisted      boolean not null default false,
  expected_qty     numeric(14,2) not null default 0,
  physical_qty     numeric(14,2) not null default 0,
  matched_qty      numeric(14,2) not null default 0,
  short_qty        numeric(14,2) not null default 0,
  excess_qty       numeric(14,2) not null default 0,
  result           text not null check (result in ('MATCH','SHORT','EXCESS')),
  created_at       timestamptz not null default now()
);
create index on public.reconciliation_results(session_id);
create index on public.reconciliation_results(audit_cycle_id, store_id, result);
create index on public.reconciliation_results(item_sno) where item_sno is not null;   -- cross-store serial lookups

create table public.audit_events (                 -- append-only
  id             bigint generated always as identity primary key,
  event_type     text not null check (event_type in (
    'LOGIN','AUDIT_STARTED','SERIAL_SCANNED','SERIAL_DUPLICATE','SERIAL_NOT_FOUND','UNLISTED_SERIAL_ADDED',
    'NON_SERIAL_ADDED','ENTRY_REMOVED','ENTRY_EDITED','PREVIEW_OPENED','AUDIT_SUBMITTED','AUDIT_LOCKED',
    'AUDIT_REOPENED','BASE_UPLOADED','BASE_FROZEN','USER_APPROVED','USER_REJECTED','USER_STORE_CHANGED',
    'REPORT_EXPORTED','VALIDATION_FAILED')),
  user_id        uuid references public.profiles(id),
  role           public.user_role,
  store_id       uuid references public.stores(id),
  audit_cycle_id uuid references public.audit_cycles(id),
  session_id     uuid references public.audit_sessions(id),
  record_id      uuid,
  metadata       jsonb not null default '{}',
  created_at     timestamptz not null default now()
);
create index on public.audit_events(audit_cycle_id, created_at desc);
create index on public.audit_events(store_id, created_at desc);
create index on public.audit_events(event_type);

-- ---------- authorization helpers (SECURITY DEFINER, no RLS recursion) ----
create or replace function public.app_role() returns public.user_role
language sql stable security definer set search_path = '' as $$
  select role from public.profiles where id = auth.uid() and status = 'APPROVED'
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(public.app_role() = 'ADMIN', false)
$$;

create or replace function public.my_store_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select a.store_id from public.user_store_assignments a
  join public.profiles p on p.id = a.user_id and p.status = 'APPROVED' and p.role = 'STORE_USER'
  where a.user_id = auth.uid()
$$;

create or replace function public.my_circle_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select s.circle_id from public.stores s where s.id = public.my_store_id()
$$;

create or replace function public.can_manage_circle(p_circle uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_admin() or (
    public.app_role() = 'CIRCLE_HEAD' and exists (
      select 1 from public.circle_head_assignments a where a.user_id = auth.uid() and a.circle_id = p_circle))
$$;

create or replace function public.can_manage_store(p_store uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(public.is_admin() or (
    public.app_role() = 'CIRCLE_HEAD' and exists (
      select 1 from public.stores s
      join public.circle_head_assignments a on a.circle_id = s.circle_id and a.user_id = auth.uid()
      where s.id = p_store)), false)
$$;

create or replace function public.can_see_store(p_store uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.can_manage_store(p_store) or (public.my_store_id() is not null and public.my_store_id() = p_store)
$$;

create or replace function public.try_uuid(p text) returns uuid
language plpgsql immutable set search_path = '' as $$
begin return p::uuid; exception when others then return null; end $$;

-- ---------- event logger (internal only) -----------------------------
create or replace function public.log_event(
  p_type text, p_store uuid default null, p_cycle uuid default null,
  p_session uuid default null, p_record uuid default null, p_meta jsonb default '{}')
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.audit_events(event_type, user_id, role, store_id, audit_cycle_id, session_id, record_id, metadata)
  values (p_type, auth.uid(), (select role from public.profiles where id = auth.uid()),
          p_store, p_cycle, p_session, p_record, coalesce(p_meta,'{}'));
end $$;
revoke execute on function public.log_event(text,uuid,uuid,uuid,uuid,jsonb) from public, anon, authenticated;

-- ---------- signup: every new auth user becomes a PENDING store user ----
-- Role and status are forced here. Client metadata can NEVER set role/status.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_store uuid := public.try_uuid(new.raw_user_meta_data->>'store_id');
begin
  insert into public.profiles(id, full_name, employee_id, email, mobile, role, status, requested_store_id)
  values (new.id,
          coalesce(nullif(btrim(new.raw_user_meta_data->>'full_name'),''), split_part(new.email,'@',1)),
          nullif(btrim(new.raw_user_meta_data->>'employee_id'),''),
          new.email,
          nullif(btrim(new.raw_user_meta_data->>'mobile'),''),
          'STORE_USER', 'PENDING',
          (select id from public.stores where id = v_store and active));
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- integrity triggers ---------------------------------------
-- 1) base stock: frozen/superseded uploads are immutable
create or replace function public.guard_base_stock() returns trigger
language plpgsql set search_path = '' as $$
begin
  if exists (select 1 from public.base_stock_uploads u
             where u.id = coalesce(old.upload_id, new.upload_id) and u.status in ('FROZEN','SUPERSEDED')) then
    raise exception 'Base stock is frozen and cannot be changed.' using errcode = '42501';
  end if;
  return coalesce(new, old);
end $$;
create trigger trg_guard_base_stock before insert or update or delete on public.base_stock
  for each row execute function public.guard_base_stock();

create or replace function public.guard_upload_delete() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.status in ('FROZEN','SUPERSEDED') then
    raise exception 'A frozen base stock upload cannot be deleted.' using errcode = '42501';
  end if;
  return old;
end $$;
create trigger trg_guard_upload_delete before delete on public.base_stock_uploads
  for each row execute function public.guard_upload_delete();

-- 2) scans / entries: only writable while the parent session is IN_PROGRESS;
--    cycle + store are copied from the session so they cannot be spoofed.
create or replace function public.guard_open_session() returns trigger
language plpgsql set search_path = '' as $$
declare v_sid uuid := coalesce(new.session_id, old.session_id); s public.audit_sessions;
begin
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
create trigger trg_guard_scans   before insert or update or delete on public.audit_serial_scans
  for each row execute function public.guard_open_session();
create trigger trg_guard_entries before insert or update or delete on public.audit_non_serial_entries
  for each row execute function public.guard_open_session();

-- 3) history is preserved: sessions & recon can't be deleted, events are append-only
create or replace function public.block_mutation() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception '% on % is not allowed (history is preserved).', tg_op, tg_table_name using errcode = '42501';
end $$;
create trigger trg_sessions_no_delete before delete on public.audit_sessions
  for each row execute function public.block_mutation();
create trigger trg_recon_immutable before update or delete on public.reconciliation_results
  for each row execute function public.block_mutation();
create trigger trg_events_append_only before update or delete on public.audit_events
  for each row execute function public.block_mutation();

-- ---------- user-management RPCs -------------------------------------
create or replace function public.public_store_list()   -- for the signup dropdown (anon, pre-login)
returns table(id uuid, code text, name text, circle_code text)
language sql stable security definer set search_path = '' as $$
  select s.id, s.code, s.name, c.code from public.stores s join public.circles c on c.id = s.circle_id
  where s.active order by c.code, s.code
$$;

create or replace function public.log_login() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Your session has expired.' using errcode = '28000'; end if;
  perform public.log_event('LOGIN', public.my_store_id());
end $$;

create or replace function public.update_my_profile(p_name text, p_mobile text) returns void
language sql security definer set search_path = '' as $$
  update public.profiles set full_name = coalesce(nullif(btrim(p_name),''), full_name),
                             mobile    = coalesce(nullif(btrim(p_mobile),''), mobile)
  where id = auth.uid()
$$;

create or replace function public.approve_user(p_user uuid, p_store uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v public.profiles;
begin
  select * into v from public.profiles where id = p_user for update;
  if not found or v.role <> 'STORE_USER' then raise exception 'User not found.' using errcode = 'P0002'; end if;
  if not public.can_manage_store(p_store)
     or (v.requested_store_id is not null and not public.can_manage_store(v.requested_store_id)) then
    raise exception 'You do not have permission to perform this action.' using errcode = '42501';
  end if;
  update public.profiles set status = 'APPROVED', reviewed_by = auth.uid(), reviewed_at = now(), reject_reason = null
   where id = p_user;
  insert into public.user_store_assignments(user_id, store_id, assigned_by) values (p_user, p_store, auth.uid())
  on conflict (user_id) do update set store_id = excluded.store_id, assigned_by = excluded.assigned_by, assigned_at = now();
  perform public.log_event('USER_APPROVED', p_store, null, null, p_user,
          jsonb_build_object('requested_store', v.requested_store_id, 'assigned_store', p_store));
end $$;

create or replace function public.reject_user(p_user uuid, p_reason text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare v public.profiles;
begin
  select * into v from public.profiles where id = p_user for update;
  if not found or v.role <> 'STORE_USER' then raise exception 'User not found.' using errcode = 'P0002'; end if;
  if not (public.is_admin() or (v.requested_store_id is not null and public.can_manage_store(v.requested_store_id))) then
    raise exception 'You do not have permission to perform this action.' using errcode = '42501';
  end if;
  update public.profiles set status = 'REJECTED', reviewed_by = auth.uid(), reviewed_at = now(), reject_reason = p_reason
   where id = p_user;
  delete from public.user_store_assignments where user_id = p_user;
  perform public.log_event('USER_REJECTED', v.requested_store_id, null, null, p_user, jsonb_build_object('reason', p_reason));
end $$;

create or replace function public.change_user_store(p_user uuid, p_new_store uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_old uuid;
begin
  select store_id into v_old from public.user_store_assignments where user_id = p_user;
  if v_old is null or not public.can_manage_store(v_old) or not public.can_manage_store(p_new_store) then
    raise exception 'You do not have permission to perform this action.' using errcode = '42501';
  end if;
  update public.user_store_assignments set store_id = p_new_store, assigned_by = auth.uid(), assigned_at = now()
   where user_id = p_user;
  perform public.log_event('USER_STORE_CHANGED', p_new_store, null, null, p_user,
          jsonb_build_object('from_store', v_old, 'to_store', p_new_store));
end $$;

create or replace function public.admin_set_role(p_user uuid, p_role public.user_role) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'You do not have permission to perform this action.' using errcode = '42501'; end if;
  if p_user = auth.uid() then raise exception 'You cannot change your own role.' using errcode = '42501'; end if;
  update public.profiles set role = p_role, status = 'APPROVED', reviewed_by = auth.uid(), reviewed_at = now() where id = p_user;
  if p_role <> 'STORE_USER' then delete from public.user_store_assignments where user_id = p_user; end if;
  if p_role <> 'CIRCLE_HEAD' then delete from public.circle_head_assignments where user_id = p_user; end if;
end $$;

-- ---------- privileges -----------------------------------------------
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public;
revoke all on all tables in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon;

grant usage on schema public to anon, authenticated;
grant select on public.profiles, public.circles, public.stores, public.user_store_assignments,
  public.circle_head_assignments, public.audit_cycles, public.audit_cycle_stores, public.base_stock_uploads,
  public.base_stock, public.audit_sessions, public.audit_serial_scans, public.audit_non_serial_entries,
  public.reconciliation_results, public.audit_events to authenticated;
-- RLS-gated direct writes (admin / circle head tooling only)
grant insert, update, delete on public.circles, public.stores, public.audit_cycles, public.circle_head_assignments to authenticated;
grant insert (audit_cycle_id, store_id), delete on public.audit_cycle_stores to authenticated;   -- active_upload_id: freeze RPC only
grant insert (audit_cycle_id, store_id, version, source_file_name, source_file_path), delete on public.base_stock_uploads to authenticated;
grant update (source_file_name, source_file_path, rows_uploaded, rows_valid, serialized_count, non_serialized_count, error_summary)
  on public.base_stock_uploads to authenticated;                                                 -- status: RPC only
grant insert, delete on public.base_stock to authenticated;                                      -- draft uploads only (policy + trigger)

grant execute on function public.public_store_list() to anon, authenticated;
grant execute on function public.app_role(), public.is_admin(), public.my_store_id(), public.my_circle_id(),
  public.can_manage_circle(uuid), public.can_manage_store(uuid), public.can_see_store(uuid), public.try_uuid(text),
  public.log_login(), public.update_my_profile(text,text), public.approve_user(uuid,uuid),
  public.reject_user(uuid,text), public.change_user_store(uuid,uuid), public.admin_set_role(uuid,public.user_role)
  to authenticated;

-- ---------- Row Level Security ---------------------------------------
alter table public.circles                 enable row level security;
alter table public.stores                  enable row level security;
alter table public.profiles                enable row level security;
alter table public.user_store_assignments  enable row level security;
alter table public.circle_head_assignments enable row level security;
alter table public.audit_cycles            enable row level security;
alter table public.audit_cycle_stores      enable row level security;
alter table public.base_stock_uploads      enable row level security;
alter table public.base_stock              enable row level security;
alter table public.audit_sessions          enable row level security;
alter table public.audit_serial_scans      enable row level security;
alter table public.audit_non_serial_entries enable row level security;
alter table public.reconciliation_results  enable row level security;
alter table public.audit_events            enable row level security;

-- reference data
create policy circles_read  on public.circles for select to authenticated
  using (public.can_manage_circle(id) or id = public.my_circle_id());
create policy circles_admin on public.circles for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy stores_read   on public.stores  for select to authenticated using (public.can_see_store(id));
create policy stores_admin  on public.stores  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- people (all writes via RPC)
create policy profiles_read on public.profiles for select to authenticated using (
  id = auth.uid() or public.is_admin()
  or (role = 'STORE_USER' and (
        (requested_store_id is not null and public.can_manage_store(requested_store_id))
     or exists (select 1 from public.user_store_assignments a where a.user_id = profiles.id and public.can_manage_store(a.store_id)))));
create policy usa_read on public.user_store_assignments for select to authenticated
  using (user_id = auth.uid() or public.can_manage_store(store_id));
create policy cha_read  on public.circle_head_assignments for select to authenticated using (user_id = auth.uid() or public.is_admin());
create policy cha_admin on public.circle_head_assignments for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- cycles
create policy cycles_read on public.audit_cycles for select to authenticated using (
  public.app_role() in ('ADMIN','CIRCLE_HEAD')
  or (status in ('ACTIVE','COMPLETED') and exists (
        select 1 from public.audit_cycle_stores s where s.audit_cycle_id = audit_cycles.id and s.store_id = public.my_store_id())));
create policy cycles_admin on public.audit_cycles for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy acs_read   on public.audit_cycle_stores for select to authenticated using (public.can_see_store(store_id));
create policy acs_insert on public.audit_cycle_stores for insert to authenticated with check (public.can_manage_store(store_id));
create policy acs_delete on public.audit_cycle_stores for delete to authenticated
  using (public.can_manage_store(store_id) and active_upload_id is null);

-- base stock: staff only. STORE_USER has NO policy => zero rows, ever.
create policy uploads_read   on public.base_stock_uploads for select to authenticated using (public.can_manage_store(store_id));
create policy uploads_insert on public.base_stock_uploads for insert to authenticated
  with check (public.can_manage_store(store_id) and status = 'DRAFT');
create policy uploads_update on public.base_stock_uploads for update to authenticated
  using (public.can_manage_store(store_id) and status = 'DRAFT') with check (public.can_manage_store(store_id));
create policy uploads_delete on public.base_stock_uploads for delete to authenticated
  using (public.can_manage_store(store_id) and status in ('DRAFT','DISCARDED'));

create policy base_read   on public.base_stock for select to authenticated using (public.can_manage_store(store_id));
create policy base_insert on public.base_stock for insert to authenticated with check (
  public.can_manage_store(store_id)
  and exists (select 1 from public.base_stock_uploads u
              where u.id = upload_id and u.status = 'DRAFT'
                and u.store_id = base_stock.store_id and u.audit_cycle_id = base_stock.audit_cycle_id));
create policy base_delete on public.base_stock for delete to authenticated using (public.can_manage_store(store_id));

-- audit data: read-only for everyone (writes via RPC). Store users see only their own store.
create policy sessions_read on public.audit_sessions          for select to authenticated using (public.can_see_store(store_id));
create policy scans_read    on public.audit_serial_scans      for select to authenticated using (public.can_see_store(store_id));
create policy entries_read  on public.audit_non_serial_entries for select to authenticated using (public.can_see_store(store_id));

-- results: store users only see the CURRENT locked version (never an older version while a reopened audit is in progress)
create policy recon_read on public.reconciliation_results for select to authenticated using (
  public.can_manage_store(store_id)
  or (public.can_see_store(store_id) and exists (
        select 1 from public.audit_sessions s where s.id = reconciliation_results.session_id and s.status = 'LOCKED')));

-- logs: staff only
create policy events_read on public.audit_events for select to authenticated using (
  public.is_admin() or (store_id is not null and public.can_manage_store(store_id)));

-- ---------- private storage for original base-stock Excel files ------
insert into storage.buckets (id, name, public) values ('base-stock-files', 'base-stock-files', false)
on conflict (id) do nothing;

-- object path convention: <audit_cycle_id>/<store_id>/<upload_id>.xlsx
create policy bsf_read   on storage.objects for select to authenticated
  using (bucket_id = 'base-stock-files' and public.can_manage_store(public.try_uuid(split_part(name,'/',2))));
create policy bsf_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'base-stock-files' and public.can_manage_store(public.try_uuid(split_part(name,'/',2))));
create policy bsf_delete on storage.objects for delete to authenticated
  using (bucket_id = 'base-stock-files' and public.is_admin());
