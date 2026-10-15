-- =====================================================================
-- 15_management_signup.sql | Two sign-up paths: Store level and Management level (Circle Head / Admin).
-- Run after 14_delete_account.sql (safe to run again).
--
-- A management sign-up NEVER grants a role by itself. The person registers like everyone else (role STORE_USER, status PENDING)
-- and the trigger only RECORDS what they asked for (requested_role + requested_circles). An existing Admin then approves it:
--   admin_approve_management(user, role, circles)   Admin only. Sets the role and (for a Circle Head) the circles they manage.
-- Circle Heads cannot see or approve management requests. approve_user() (the store-user approval) refuses them too.
-- =====================================================================
alter table public.profiles add column if not exists requested_role public.user_role;
alter table public.profiles add column if not exists requested_circles text[];
alter table public.profiles drop constraint if exists profiles_requested_role_chk;
alter table public.profiles add constraint profiles_requested_role_chk check (requested_role is null or requested_role in ('CIRCLE_HEAD', 'ADMIN'));

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_store uuid := public.try_uuid(new.raw_user_meta_data->>'store_id');
  v_req public.user_role := case upper(btrim(coalesce(new.raw_user_meta_data->>'requested_role', ''))) when 'CIRCLE_HEAD' then 'CIRCLE_HEAD'::public.user_role when 'ADMIN' then 'ADMIN'::public.user_role else null end;
  v_circ text[] := null;
begin
  if v_req = 'CIRCLE_HEAD' then       -- keep only circle codes that really exist
    select array_agg(c.code order by c.code) into v_circ from public.circles c
     where c.code in (select jsonb_array_elements_text(case when jsonb_typeof(new.raw_user_meta_data->'requested_circles') = 'array' then new.raw_user_meta_data->'requested_circles' else '[]'::jsonb end));
  end if;
  insert into public.profiles(id, full_name, employee_id, email, mobile, role, status, requested_store_id, requested_role, requested_circles)
  values (new.id,
          coalesce(nullif(btrim(new.raw_user_meta_data->>'full_name'), ''), split_part(new.email, '@', 1)),
          nullif(btrim(new.raw_user_meta_data->>'employee_id'), ''),
          new.email,
          nullif(btrim(new.raw_user_meta_data->>'mobile'), ''),
          'STORE_USER', 'PENDING',                       -- the role is NEVER taken from the sign-up form
          case when v_req is null then (select id from public.stores where id = v_store and active) else null end,
          v_req, v_circ);
  return new;
end $$;

-- store-user approval must not be used for a management request
create or replace function public.approve_user(p_user uuid, p_store uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v public.profiles;
begin
  select * into v from public.profiles where id = p_user for update;
  if not found or v.role <> 'STORE_USER' then raise exception 'User not found.' using errcode = 'P0002'; end if;
  if v.requested_role is not null then raise exception 'This is a management access request. Approve it as Circle Head / Admin from the Users page.' using errcode = 'P0001'; end if;
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

create or replace function public.admin_approve_management(p_user uuid, p_role public.user_role, p_circles uuid[]) returns void
language plpgsql security definer set search_path = '' as $$
declare v public.profiles;
begin
  if not public.is_admin() then raise exception 'You do not have permission to perform this action.' using errcode = '42501'; end if;
  if p_user = auth.uid() then raise exception 'You cannot change your own role.' using errcode = '42501'; end if;
  if p_role is null or p_role not in ('CIRCLE_HEAD', 'ADMIN') then raise exception 'Choose Circle Head or Admin.' using errcode = 'P0001'; end if;
  select * into v from public.profiles where id = p_user and deleted_at is null for update;
  if not found then raise exception 'User not found.' using errcode = 'P0002'; end if;
  if v.status = 'APPROVED' then raise exception 'This user is already active. Use the Role button to change their role.' using errcode = 'P0001'; end if;
  if p_role = 'CIRCLE_HEAD' and coalesce(array_length(p_circles, 1), 0) = 0 then raise exception 'Select at least one circle for the Circle Head.' using errcode = 'P0001'; end if;
  update public.profiles
     set role = p_role, status = 'APPROVED', reviewed_by = auth.uid(), reviewed_at = now(), reject_reason = null,
         requested_role = null, requested_circles = null, requested_store_id = null
   where id = p_user;
  delete from public.user_store_assignments where user_id = p_user;
  delete from public.circle_head_assignments where user_id = p_user;
  if p_role = 'CIRCLE_HEAD' then
    insert into public.circle_head_assignments(user_id, circle_id) select p_user, c from unnest(p_circles) c on conflict do nothing;
  end if;
  perform public.log_event('USER_APPROVED', null, null, null, p_user, jsonb_build_object('role', p_role, 'circles', p_circles));
end $$;
revoke execute on function public.admin_approve_management(uuid, public.user_role, uuid[]) from public, anon;
grant execute on function public.admin_approve_management(uuid, public.user_role, uuid[]) to authenticated;
