-- =====================================================================
-- 26_cycle_close_rules.sql
--   A cycle now closes ONLY when:
--     1) its deadline passes, or
--     2) an admin closes it by hand (admin_close_cycle).
--   Creating a new cycle NO LONGER closes the previous one.
-- Run once in the Supabase SQL Editor, after 25_perf_indexes.sql (safe to re-run).
-- =====================================================================

-- ---------- 1) helper: close every ACTIVE cycle whose deadline has passed ----------
-- Idempotent. Called at the start of the RPCs the app hits in normal use, so an
-- overdue cycle flips to COMPLETED the next time anyone touches the system.
create or replace function public._close_overdue_cycles() returns int
language plpgsql security definer set search_path = '' as $$
declare n int := 0; r record;
begin
  for r in select id, name from public.audit_cycles
           where status = 'ACTIVE' and deadline_at is not null and deadline_at < now()
           for update skip locked
  loop
    update public.audit_cycles set status = 'COMPLETED' where id = r.id;
    perform public.log_event('CYCLE_CLOSED', null, r.id, null, null,
      jsonb_build_object('name', r.name, 'reason', 'deadline passed'));
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function public._close_overdue_cycles() from public, anon, authenticated;

-- ---------- 2) creating a cycle no longer closes the previous one ----------
-- (only overdue cycles are swept shut, per rule 1)
create or replace function public.admin_create_cycle(p_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if not public.is_admin() then raise exception 'You do not have permission to perform this action.' using errcode = '42501'; end if;
  if length(btrim(coalesce(p_name, ''))) < 2 then raise exception 'Please enter a cycle name.' using errcode = 'P0001'; end if;
  perform public._close_overdue_cycles();
  insert into public.audit_cycles(name, status, deadline_at) values (btrim(p_name), 'ACTIVE', now() + interval '3 days') returning id into v_id;
  return v_id;
end $$;

-- ---------- 3) the app's hot paths sweep overdue cycles shut ----------
-- my_audit_context: store user's entry point (was in 22_audit_deadlines.sql)
create or replace function public.my_audit_context() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_store uuid := public.my_store_id(); st public.stores; cy public.audit_cycles; s public.audit_sessions; v_circle text;
begin
  if public.app_role() is distinct from 'STORE_USER' or v_store is null then
    raise exception 'You do not have permission to perform this action.' using errcode = '42501'; end if;
  perform public._close_overdue_cycles();
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
    'cycle', case when cy.id is null then null else jsonb_build_object('id', cy.id, 'name', cy.name, 'deadline_at', cy.deadline_at) end,
    'session', case when s.id is null then null else jsonb_build_object('id', s.id, 'version', s.version, 'status', s.status, 'submitted_at', s.submitted_at,
                                                                         'reopen_reason', s.reopen_reason, 'reopened_at', s.reopened_at) end,
    'counts', case when s.id is null then null else public._counts(s.id) end);
end $$;

-- store_open_cycles: base-data setup list (was in 17_close_cycle_store_base.sql; now VOLATILE so it can sweep)
create or replace function public.store_open_cycles() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_store uuid := public.my_store_id();
begin
  if public.app_role() is distinct from 'STORE_USER' or v_store is null then
    raise exception 'You do not have permission to perform this action.' using errcode = '42501'; end if;
  perform public._close_overdue_cycles();
  return jsonb_build_object('store_id', v_store, 'cycles', (
    select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'base_frozen', a.active_upload_id is not null, 'frozen_at', a.frozen_at,
             'audit_started', exists (select 1 from public.audit_sessions s where s.audit_cycle_id = c.id and s.store_id = v_store)) order by c.created_at desc), '[]'::jsonb)
      from public.audit_cycles c left join public.audit_cycle_stores a on a.audit_cycle_id = c.id and a.store_id = v_store
     where c.status = 'ACTIVE'));
end $$;

-- cycle_progress: admin sidebar (was in 22_audit_deadlines.sql; now VOLATILE so it can sweep)
create or replace function public.cycle_progress(p_cycle uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if public.app_role() not in ('ADMIN','CIRCLE_HEAD') then raise exception 'You do not have permission to perform this action.' using errcode = '42501'; end if;
  perform public._close_overdue_cycles();
  return (select jsonb_build_object('completed', count(*) filter (where audit_status = 'COMPLETED'), 'total', count(*),
            'overdue', count(*) filter (where audit_status <> 'COMPLETED' and (select deadline_at from public.audit_cycles where id = p_cycle) < now()))
            from public._dash_rows(p_cycle));
end $$;

-- grants (same as before for the public RPCs; the _ helper stays private)
revoke execute on function public.admin_create_cycle(text), public.my_audit_context(), public.store_open_cycles(), public.cycle_progress(uuid) from public, anon;
grant execute on function public.admin_create_cycle(text), public.my_audit_context(), public.store_open_cycles(), public.cycle_progress(uuid) to authenticated;
