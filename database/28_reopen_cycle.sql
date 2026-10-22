-- =====================================================================
-- 28_reopen_cycle.sql
--   Admins can REOPEN a closed audit cycle (for corrections). Reopening:
--     * sets the cycle back to ACTIVE, so store users can audit in it
--       again and base data can be set up by the usual roles;
--     * gives a FRESH 3-day deadline from now — without it, the
--       auto-close sweep (migration 26) would close the cycle again
--       immediately, because the old deadline has already passed;
--     * touches nothing else: audits, base stock, results and logs stay.
--   Also the rule behind the client fix shipped with this migration:
--   a CLOSED cycle is never "overdue" — overdue only applies while a
--   cycle is open (the sidebar chip, progress line and dashboard badges
--   now check the cycle status before showing it).
-- Run once in the Supabase SQL Editor, after 27_storage_backup_fix.sql (safe to re-run).
-- =====================================================================

-- ---------- 1) new log entry type (audit_events has a fixed list) ----------
alter table public.audit_events drop constraint if exists audit_events_event_type_check;
alter table public.audit_events add constraint audit_events_event_type_check check (event_type in (
  'LOGIN','AUDIT_STARTED','SERIAL_SCANNED','SERIAL_DUPLICATE','SERIAL_NOT_FOUND','UNLISTED_SERIAL_ADDED',
  'NON_SERIAL_ADDED','ENTRY_REMOVED','ENTRY_EDITED','PREVIEW_OPENED','AUDIT_SUBMITTED','AUDIT_LOCKED',
  'AUDIT_REOPENED','BASE_UPLOADED','BASE_FROZEN','USER_APPROVED','USER_REJECTED','USER_STORE_CHANGED',
  'REPORT_EXPORTED','VALIDATION_FAILED','STORE_REPORT_NAME_SET','BASE_UPLOAD_WARNING','CYCLE_DELETED','USER_DELETED',
  'CYCLE_CLOSED','CYCLE_REOPENED'));

-- ---------- 2) the reopen function ----------
create or replace function public.admin_reopen_cycle(p_cycle uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_name text; v_status text; v_deadline timestamptz;
begin
  if not public.is_admin() then raise exception 'You do not have permission to perform this action.' using errcode = '42501'; end if;
  select name, status::text into v_name, v_status from public.audit_cycles where id = p_cycle for update;
  if not found then raise exception 'Cycle not found.' using errcode = 'P0002'; end if;
  if v_status = 'ACTIVE' then raise exception 'This cycle is already open.' using errcode = 'P0001'; end if;
  v_deadline := now() + interval '3 days';
  update public.audit_cycles set status = 'ACTIVE', deadline_at = v_deadline where id = p_cycle;
  perform public.log_event('CYCLE_REOPENED', null, p_cycle, null, null,
    jsonb_build_object('name', v_name, 'new_deadline', v_deadline));
  return jsonb_build_object('name', v_name, 'deadline_at', v_deadline);
end $$;

revoke execute on function public.admin_reopen_cycle(uuid) from public, anon;
grant execute on function public.admin_reopen_cycle(uuid) to authenticated;
