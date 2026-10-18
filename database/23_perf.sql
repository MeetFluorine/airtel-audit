-- 23_perf.sql : small performance helpers. Safe to re-run. Run after 22 (order vs 21/22 does not matter).
--
-- session_counted_units(p_session): returns how much an in-progress audit has
-- counted so far - serial scan count + non-serialized quantity sum - computed
-- on the server in ONE call. Replaces pulling every non-serialized entry row
-- to the browser just to sum it (store detail > Overview tab, audit in progress).

create or replace function public.session_counted_units(p_session uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_store uuid; v_role text;
begin
  select s.store_id into v_store from public.audit_sessions s where s.id = p_session;
  if v_store is null then raise exception 'Session not found.' using errcode = 'P0001'; end if;
  v_role := public.app_role();
  if v_role = 'STORE_USER' then
    if v_store is distinct from public.my_store_id() then
      raise exception 'You do not have permission to perform this action.' using errcode = '42501'; end if;
  elsif not public.can_manage_store(v_store) then
    raise exception 'You do not have permission to perform this action.' using errcode = '42501';
  end if;
  return (select jsonb_build_object(
    'serial_scans', (select count(*) from public.audit_serial_scans where session_id = p_session),
    'non_serial_qty', coalesce((select sum(physical_qty) from public.audit_non_serial_entries where session_id = p_session), 0)));
end $$;
