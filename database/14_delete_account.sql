-- =====================================================================
-- 14_delete_account.sql | Permanent account deletion.
-- Run after 13_dashboard_filter.sql (safe to run again).
--
--   delete_my_account(p_confirm)        any signed-in user deletes their OWN account (type DELETE to confirm)
--   admin_delete_user(p_user, p_confirm) Admin: any other user.  Circle Head: store users of their own circles only.
--
-- What "permanently deleted" means here:
--   * the login is deleted (they can never sign in again; the e-mail address can be used to register again)
--   * name, e-mail, mobile and employee ID are erased, store / circle assignments are removed
--   * audit history is KEPT (scans, submitted audits, logs). It is evidence for the stores, so it stays, but it now
--     points to an anonymous "Deleted user" instead of a person. This is why audit rows never block a deletion.
-- Protections: you cannot delete the only remaining Admin; a Circle Head cannot delete Admins or other Circle Heads;
-- nobody can delete themselves through the admin screen (they use My Account).
-- =====================================================================

-- 1) a profile row may outlive its login (it becomes the anonymous placeholder)
do $$ declare r record; begin
  for r in select conname from pg_constraint
            where conrelid = 'public.profiles'::regclass and confrelid = 'auth.users'::regclass and contype = 'f' loop
    execute format('alter table public.profiles drop constraint %I', r.conname);
  end loop;
end $$;
alter table public.profiles add column if not exists deleted_at timestamptz;

-- 2) placeholders are invisible in the app (user lists etc.); same rule as before otherwise
drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select to authenticated using (
  deleted_at is null and (
    id = auth.uid() or public.is_admin()
    or (role = 'STORE_USER' and (
          (requested_store_id is not null and public.can_manage_store(requested_store_id))
       or exists (select 1 from public.user_store_assignments a where a.user_id = profiles.id and public.can_manage_store(a.store_id))))));

-- 3) new log entry type
alter table public.audit_events drop constraint if exists audit_events_event_type_check;
alter table public.audit_events add constraint audit_events_event_type_check check (event_type in (
  'LOGIN','AUDIT_STARTED','SERIAL_SCANNED','SERIAL_DUPLICATE','SERIAL_NOT_FOUND','UNLISTED_SERIAL_ADDED',
  'NON_SERIAL_ADDED','ENTRY_REMOVED','ENTRY_EDITED','PREVIEW_OPENED','AUDIT_SUBMITTED','AUDIT_LOCKED',
  'AUDIT_REOPENED','BASE_UPLOADED','BASE_FROZEN','USER_APPROVED','USER_REJECTED','USER_STORE_CHANGED',
  'REPORT_EXPORTED','VALIDATION_FAILED','STORE_REPORT_NAME_SET','BASE_UPLOAD_WARNING','CYCLE_DELETED','USER_DELETED'));

-- 4) the one place that erases a person (not callable from the app)
create or replace function public._erase_user(p_user uuid, p_by text) returns void
language plpgsql security definer set search_path = '' as $$
declare p public.profiles; v_store uuid;
begin
  select * into p from public.profiles where id = p_user for update;
  if not found or p.deleted_at is not null then raise exception 'User not found.' using errcode = 'P0002'; end if;
  select store_id into v_store from public.user_store_assignments where user_id = p_user;
  perform public.log_event('USER_DELETED', v_store, null, null, p_user, jsonb_build_object('deleted_role', p.role, 'by', p_by));
  delete from public.user_store_assignments where user_id = p_user;
  delete from public.circle_head_assignments where user_id = p_user;
  update public.profiles
     set full_name = 'Deleted user', email = null, mobile = null, employee_id = null, requested_store_id = null,
         reject_reason = null, status = 'REJECTED', deleted_at = now()
   where id = p_user;
  delete from auth.users where id = p_user;
end $$;
revoke execute on function public._erase_user(uuid, text) from public, anon, authenticated;

-- 5) delete my own account
create or replace function public.delete_my_account(p_confirm text) returns void
language plpgsql security definer set search_path = '' as $$
declare me public.profiles;
begin
  if auth.uid() is null then raise exception 'Please sign in again.' using errcode = '42501'; end if;
  if upper(btrim(coalesce(p_confirm, ''))) <> 'DELETE' then raise exception 'Type DELETE to confirm.' using errcode = 'P0001'; end if;
  select * into me from public.profiles where id = auth.uid() and deleted_at is null;
  if not found then raise exception 'Account not found.' using errcode = 'P0002'; end if;
  if me.role = 'ADMIN' and not exists (select 1 from public.profiles where role = 'ADMIN' and status = 'APPROVED' and deleted_at is null and id <> me.id) then
    raise exception 'You are the only Admin. Make another person an Admin before deleting your account.' using errcode = '42501';
  end if;
  perform public._erase_user(me.id, 'self');
end $$;

-- 6) admin / circle head deletes someone else
create or replace function public.admin_delete_user(p_user uuid, p_confirm text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_role public.user_role := public.app_role(); t public.profiles;
begin
  if v_role is null or v_role not in ('ADMIN', 'CIRCLE_HEAD') then raise exception 'You do not have permission to perform this action.' using errcode = '42501'; end if;
  if p_user = auth.uid() then raise exception 'Use My Account to delete your own account.' using errcode = '42501'; end if;
  if upper(btrim(coalesce(p_confirm, ''))) <> 'DELETE' then raise exception 'Type DELETE to confirm.' using errcode = 'P0001'; end if;
  select * into t from public.profiles where id = p_user and deleted_at is null;
  if not found then raise exception 'User not found.' using errcode = 'P0002'; end if;
  if v_role = 'CIRCLE_HEAD' and not (t.role = 'STORE_USER' and (
        (t.requested_store_id is not null and public.can_manage_store(t.requested_store_id))
     or exists (select 1 from public.user_store_assignments a where a.user_id = t.id and public.can_manage_store(a.store_id)))) then
    raise exception 'You can only delete store users in your own circles.' using errcode = '42501';
  end if;
  perform public._erase_user(p_user, case when v_role = 'ADMIN' then 'admin' else 'circle_head' end);
end $$;

revoke execute on function public.delete_my_account(text), public.admin_delete_user(uuid, text) from public, anon;
grant execute on function public.delete_my_account(text), public.admin_delete_user(uuid, text) to authenticated;
