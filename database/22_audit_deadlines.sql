-- =====================================================================
-- 22_audit_deadlines.sql | 3-day audit deadlines with escalation.
-- Run once in the Supabase SQL editor (safe to re-run).
--
-- Rule: every audit cycle gets a deadline 3 days after it is created.
-- Stores must complete (submit) their audit by then.
--
-- What this file does:
--   1) Adds audit_cycles.deadline_at and backfills it (created_at + 3 days).
--   2) admin_create_cycle() now stamps deadline_at = now() + 3 days.
--   3) my_audit_context() returns the deadline to the store user's dashboard.
--   4) cycle_progress() also returns the overdue count for the sidebar.
--   5) report_rows() is replaced with the 21_new_reports version plus
--      "Deadline" and "Days Left" columns on the Store Status report.
--      (Run this AFTER 21_new_reports.sql.)
-- =====================================================================

alter table public.audit_cycles add column if not exists deadline_at timestamptz;
update public.audit_cycles set deadline_at = created_at + interval '3 days' where deadline_at is null;

-- New cycles: deadline is stamped automatically (3 days, not configurable).
create or replace function public.admin_create_cycle(p_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if not public.is_admin() then raise exception 'You do not have permission to perform this action.' using errcode = '42501'; end if;
  if length(btrim(coalesce(p_name, ''))) < 2 then raise exception 'Please enter a cycle name.' using errcode = 'P0001'; end if;
  update public.audit_cycles set status = 'COMPLETED' where status = 'ACTIVE';     -- previous cycle is closed (data stays until deleted)
  insert into public.audit_cycles(name, status, deadline_at) values (btrim(p_name), 'ACTIVE', now() + interval '3 days') returning id into v_id;
  return v_id;
end $$;

-- Store user's context now carries the cycle deadline for the dashboard banner.
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
    'cycle', case when cy.id is null then null else jsonb_build_object('id', cy.id, 'name', cy.name, 'deadline_at', cy.deadline_at) end,
    'session', case when s.id is null then null else jsonb_build_object('id', s.id, 'version', s.version, 'status', s.status, 'submitted_at', s.submitted_at,
                                                                         'reopen_reason', s.reopen_reason, 'reopened_at', s.reopened_at) end,
    'counts', case when s.id is null then null else public._counts(s.id) end);
end $$;

-- Sidebar progress now also reports how many stores are overdue.
create or replace function public.cycle_progress(p_cycle uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if public.app_role() not in ('ADMIN','CIRCLE_HEAD') then raise exception 'You do not have permission to perform this action.' using errcode = '42501'; end if;
  return (select jsonb_build_object('completed', count(*) filter (where audit_status = 'COMPLETED'), 'total', count(*),
            'overdue', count(*) filter (where audit_status <> 'COMPLETED' and (select deadline_at from public.audit_cycles where id = p_cycle) < now()))
            from public._dash_rows(p_cycle));
end $$;

create or replace function public.report_rows(p_report text, p_cycle uuid, p_circle uuid default null, p_store uuid default null,
                                              p_include_matched boolean default false, p_offset int default 0, p_limit int default 1000, p_export boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v jsonb; v_limit int := least(greatest(coalesce(p_limit, 1000), 1), 5000); v_off int := greatest(coalesce(p_offset, 0), 0);
begin
  if public.app_role() not in ('ADMIN','CIRCLE_HEAD') then raise exception 'You do not have permission to perform this action.' using errcode = '42501'; end if;
  if p_store is not null and not public.can_manage_store(p_store) then raise exception 'You do not have permission to perform this action.' using errcode = '42501'; end if;
  if p_report not in ('variance','serial','nonserial','store_summary','circle_summary','history',
                      'store_audit','circle_shortage','pan_india','store_status','users') then raise exception 'Unknown report.' using errcode = 'P0001'; end if;

  if p_report in ('variance','serial','nonserial') then
    with sc as (select s.id from public._scope() x join public.stores s on s.id = x.store_id where (p_circle is null or s.circle_id = p_circle) and (p_store is null or s.id = p_store)),
    ses as (select distinct on (x.store_id) x.* from public.audit_sessions x join sc on sc.id = x.store_id where x.audit_cycle_id = p_cycle and x.status = 'LOCKED' order by x.store_id, x.version desc),
    q as (
      select cy.name as "Audit Cycle", c.code as "Circle", st.code as "Store", r.item_code as "Item Code", r.inventory_status as "Inventory Status", r.item_description as "Item Description",
             r.item_uom as "UOM", r.item_quality as "Quality",
             case when r.is_serialized and r.result = 'SHORT' then r.item_sno end as "System Serial", case when r.is_serialized and r.result = 'EXCESS' then r.item_sno end as "Physical Serial",
             r.expected_qty as "Expected Qty", r.physical_qty as "Physical Qty", r.matched_qty as "Matched Qty", r.short_qty as "Short Qty", r.excess_qty as "Excess Qty",
             case when r.result = 'MATCH' then 'MATCH' when r.result = 'SHORT' then 'SHORT' when r.is_unlisted then 'EXCESS (UNLISTED)' else 'EXCESS' end as "Variance Type",
             to_char(ses.submitted_at at time zone 'Asia/Kolkata', 'YYYY-MM-DD') as "Audit Date", pr.full_name as "Submitted By"
        from public.reconciliation_results r join ses on ses.id = r.session_id join public.stores st on st.id = r.store_id join public.circles c on c.id = st.circle_id
        join public.audit_cycles cy on cy.id = r.audit_cycle_id left join public.profiles pr on pr.id = ses.submitted_by
       where (coalesce(p_include_matched, false) or r.result <> 'MATCH')
         and (p_report = 'variance' or (p_report = 'serial' and r.is_serialized) or (p_report = 'nonserial' and not r.is_serialized)))
    select jsonb_build_object('total', (select count(*) from q),
      'rows', coalesce((select jsonb_agg(to_jsonb(x)) from (select * from q order by "Circle", "Store", "Variance Type", "Item Code", coalesce("System Serial", "Physical Serial") offset v_off limit v_limit) x), '[]')) into v;

  elsif p_report = 'store_summary' then
    with sc as (select s.id from public._scope() x join public.stores s on s.id = x.store_id where (p_circle is null or s.circle_id = p_circle) and (p_store is null or s.id = p_store)),
    q as (
      select cy.name as "Audit Cycle", d.circle as "Circle", d.code as "Store Code", d.name as "Store Name", d.expected as "Expected Units", d.physical as "Physical Units", d.matched as "Matched Units",
             d.short as "Short Units", d.excess as "Excess Units", d.match_rate as "Match Rate %", d.audit_status as "Audit Status", d.version as "Version",
             to_char(d.last_updated at time zone 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI') as "Last Updated", pr.full_name as "Submitted By"
        from public._dash_rows(p_cycle) d join sc on sc.id = d.store_id join public.audit_cycles cy on cy.id = p_cycle
        left join public.audit_sessions s2 on s2.id = d.session_id and s2.status = 'LOCKED' left join public.profiles pr on pr.id = s2.submitted_by)
    select jsonb_build_object('total', (select count(*) from q),
      'rows', coalesce((select jsonb_agg(to_jsonb(x)) from (select * from q order by "Circle", "Store Code" offset v_off limit v_limit) x), '[]')) into v;

  elsif p_report = 'circle_summary' then
    with sc as (select s.id from public._scope() x join public.stores s on s.id = x.store_id where (p_circle is null or s.circle_id = p_circle) and (p_store is null or s.id = p_store)),
    d as (select r.* from public._dash_rows(p_cycle) r join sc on sc.id = r.store_id),
    g as (select d.circle_id, d.circle, count(*) as stores, count(*) filter (where audit_status = 'COMPLETED') as completed, count(*) filter (where audit_status = 'IN_PROGRESS') as in_progress,
                 count(*) filter (where audit_status = 'NOT_STARTED') as not_started, coalesce(sum(expected) filter (where audit_status = 'COMPLETED'), 0) as expected,
                 coalesce(sum(physical) filter (where audit_status = 'COMPLETED'), 0) as physical, coalesce(sum(matched) filter (where audit_status = 'COMPLETED'), 0) as matched,
                 coalesce(sum(short) filter (where audit_status = 'COMPLETED'), 0) as short, coalesce(sum(excess) filter (where audit_status = 'COMPLETED'), 0) as excess from d group by d.circle_id, d.circle),
    q as (
      select (select name from public.audit_cycles where id = p_cycle) as "Audit Cycle", g.circle as "Circle",
             (select string_agg(p.full_name, ', ' order by p.full_name) from public.circle_head_assignments a join public.profiles p on p.id = a.user_id and p.status = 'APPROVED' and p.role = 'CIRCLE_HEAD' where a.circle_id = g.circle_id) as "Circle Head",
             g.stores as "Stores", g.completed as "Completed", g.in_progress as "In Progress", g.not_started as "Not Started", g.expected as "Expected Units", g.physical as "Physical Units",
             g.matched as "Matched Units", g.short as "Short Units", g.excess as "Excess Units", case when g.expected > 0 then round(100 * g.matched / g.expected, 1) end as "Match Rate %",
             public._health(case when g.expected > 0 then round(100 * g.matched / g.expected, 1) end, g.completed) as "Status" from g)
    select jsonb_build_object('total', (select count(*) from q),
      'rows', coalesce((select jsonb_agg(to_jsonb(x)) from (select * from q order by "Circle" offset v_off limit v_limit) x), '[]')) into v;

  elsif p_report = 'history' then  -- every audit version, including reopen reasons
    with sc as (select s.id from public._scope() x join public.stores s on s.id = x.store_id where (p_circle is null or s.circle_id = p_circle) and (p_store is null or s.id = p_store)),
    q as (
      select cy.name as "Audit Cycle", c.code as "Circle", st.code as "Store", a.version as "Version",
             case a.status when 'LOCKED' then 'COMPLETED' when 'REOPENED' then 'SUPERSEDED (reopened)' else 'IN PROGRESS' end as "Status",
             p1.full_name as "Started By", to_char(a.started_at at time zone 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI') as "Started At",
             p2.full_name as "Submitted By", to_char(a.submitted_at at time zone 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI') as "Submitted At",
             p3.full_name as "Reopened By", to_char(a.reopened_at at time zone 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI') as "Reopened At", a.reopen_reason as "Reopen Reason"
        from public.audit_sessions a join sc on sc.id = a.store_id join public.stores st on st.id = a.store_id join public.circles c on c.id = st.circle_id join public.audit_cycles cy on cy.id = a.audit_cycle_id
        left join public.profiles p1 on p1.id = a.started_by left join public.profiles p2 on p2.id = a.submitted_by left join public.profiles p3 on p3.id = a.reopened_by
       where a.audit_cycle_id = p_cycle)
    select jsonb_build_object('total', (select count(*) from q),
      'rows', coalesce((select jsonb_agg(to_jsonb(x)) from (select * from q order by "Circle", "Store", "Version" offset v_off limit v_limit) x), '[]')) into v;

  elsif p_report = 'store_audit' then  -- one store: full reconciliation (overview + variance), serialized / non-serialized split
    if p_store is null then raise exception 'Select a store for this report.' using errcode = 'P0001'; end if;
    with ses as (select distinct on (x.store_id) x.* from public.audit_sessions x where x.audit_cycle_id = p_cycle and x.store_id = p_store and x.status = 'LOCKED' order by x.store_id, x.version desc),
    q as (
      select cy.name as "Audit Cycle", c.code as "Circle", st.code as "Store Code", st.name as "Store Name",
             r.item_code as "Item Code", r.item_description as "Item Description", r.inventory_status as "Inventory Status",
             r.item_uom as "UOM", r.item_quality as "Quality",
             case when r.is_serialized then 'Serialized' else 'Non-Serialized' end as "Type",
             case when r.is_serialized then r.item_sno end as "Serial No",
             r.expected_qty as "Expected Qty", r.physical_qty as "Physical Qty", r.matched_qty as "Matched Qty",
             r.short_qty as "Short Qty", r.excess_qty as "Excess Qty", r.result as "Result",
             case when r.inventory_status ilike '%transit%' then 'Yes' else 'No' end as "In Transit",
             to_char(ses.submitted_at at time zone 'Asia/Kolkata', 'YYYY-MM-DD') as "Audit Date", pr.full_name as "Submitted By"
        from public.reconciliation_results r join ses on ses.id = r.session_id join public.stores st on st.id = r.store_id join public.circles c on c.id = st.circle_id
        join public.audit_cycles cy on cy.id = r.audit_cycle_id left join public.profiles pr on pr.id = ses.submitted_by)
    select jsonb_build_object('total', (select count(*) from q),
      'rows', coalesce((select jsonb_agg(to_jsonb(x)) from (select * from q order by "Type", "Result", "Item Code", "Serial No" offset v_off limit v_limit) x), '[]')) into v;

  elsif p_report = 'circle_shortage' then  -- shortage lines only, store-wise, for one circle
    if p_circle is null then raise exception 'Select a circle for this report.' using errcode = 'P0001'; end if;
    with sc as (select s.id from public._scope() x join public.stores s on s.id = x.store_id where s.circle_id = p_circle),
    ses as (select distinct on (x.store_id) x.* from public.audit_sessions x join sc on sc.id = x.store_id where x.audit_cycle_id = p_cycle and x.status = 'LOCKED' order by x.store_id, x.version desc),
    q as (
      select cy.name as "Audit Cycle", c.code as "Circle", st.code as "Store Code", st.name as "Store Name",
             r.item_code as "Item Code", r.item_description as "Item Description", r.inventory_status as "Inventory Status",
             case when r.is_serialized then 'Serialized' else 'Non-Serialized' end as "Type",
             case when r.is_serialized then r.item_sno end as "Serial No",
             r.expected_qty as "Expected Qty", r.physical_qty as "Physical Qty", r.short_qty as "Short Qty",
             case when r.inventory_status ilike '%transit%' then 'Yes' else 'No' end as "In Transit",
             to_char(ses.submitted_at at time zone 'Asia/Kolkata', 'YYYY-MM-DD') as "Audit Date"
        from public.reconciliation_results r join ses on ses.id = r.session_id join public.stores st on st.id = r.store_id join public.circles c on c.id = st.circle_id
        join public.audit_cycles cy on cy.id = r.audit_cycle_id
       where r.result = 'SHORT')
    select jsonb_build_object('total', (select count(*) from q),
      'rows', coalesce((select jsonb_agg(to_jsonb(x)) from (select * from q order by "Store Code", "Type", "Item Code", "Serial No" offset v_off limit v_limit) x), '[]')) into v;

  elsif p_report = 'pan_india' then  -- one row per store: overview with shortage splits
    with sc as (select s.id from public._scope() x join public.stores s on s.id = x.store_id where (p_circle is null or s.circle_id = p_circle) and (p_store is null or s.id = p_store)),
    ses as (select distinct on (x.store_id) x.id, x.store_id, x.submitted_by from public.audit_sessions x join sc on sc.id = x.store_id where x.audit_cycle_id = p_cycle and x.status = 'LOCKED' order by x.store_id, x.version desc),
    agg as (
      select r.store_id,
             coalesce(sum(r.short_qty) filter (where r.inventory_status ilike '%transit%'), 0) as t_transit,
             coalesce(sum(r.short_qty) filter (where not (r.inventory_status ilike '%transit%')), 0) as t_other,
             coalesce(sum(r.short_qty) filter (where r.is_serialized), 0) as t_sser,
             coalesce(sum(r.short_qty) filter (where not r.is_serialized), 0) as t_snon
        from public.reconciliation_results r join ses on ses.id = r.session_id where r.result = 'SHORT' group by r.store_id),
    q as (
      select cy.name as "Audit Cycle", d.circle as "Circle", d.code as "Store Code", d.name as "Store Name",
             d.expected as "Expected Units", d.physical as "Physical Units", d.matched as "Matched Units", d.short as "Short Units",
             coalesce(a.t_transit, 0) as "Short In Transit", coalesce(a.t_other, 0) as "Short Other",
             coalesce(a.t_sser, 0) as "Short Serialized", coalesce(a.t_snon, 0) as "Short Non-Serialized",
             d.excess as "Excess Units", d.match_rate as "Match Rate %",
             case d.audit_status when 'COMPLETED' then 'Completed' when 'IN_PROGRESS' then 'In Progress' else 'Not Started' end as "Audit Status",
             pr.full_name as "Submitted By"
        from public._dash_rows(p_cycle) d join sc on sc.id = d.store_id join public.audit_cycles cy on cy.id = p_cycle
        left join agg a on a.store_id = d.store_id left join ses s2 on s2.store_id = d.store_id left join public.profiles pr on pr.id = s2.submitted_by)
    select jsonb_build_object('total', (select count(*) from q),
      'rows', coalesce((select jsonb_agg(to_jsonb(x)) from (select * from q order by "Circle", "Store Code" offset v_off limit v_limit) x), '[]')) into v;

  elsif p_report = 'store_status' then  -- who completed, who is pending
    with sc as (select s.id from public._scope() x join public.stores s on s.id = x.store_id where (p_circle is null or s.circle_id = p_circle) and (p_store is null or s.id = p_store)),
    q as (
      select cy.name as "Audit Cycle", d.circle as "Circle", d.code as "Store Code", d.name as "Store Name",
             case d.audit_status when 'COMPLETED' then 'Completed' when 'IN_PROGRESS' then 'In Progress' else 'Not Started' end as "Audit Status",
             d.version as "Version",
             to_char(s.started_at at time zone 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI') as "Started At",
             to_char(s.submitted_at at time zone 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI') as "Submitted At",
             pr.full_name as "Submitted By", d.match_rate as "Match Rate %",
             to_char(cy.deadline_at at time zone 'Asia/Kolkata', 'YYYY-MM-DD') as "Deadline",
             case when cy.deadline_at is null then null else ceil(extract(epoch from (cy.deadline_at - now())) / 86400)::int end as "Days Left"
        from public._dash_rows(p_cycle) d join sc on sc.id = d.store_id join public.audit_cycles cy on cy.id = p_cycle
        left join public.audit_sessions s on s.id = d.session_id left join public.profiles pr on pr.id = s.submitted_by)
    select jsonb_build_object('total', (select count(*) from q),
      'rows', coalesce((select jsonb_agg(to_jsonb(x)) from (select * from q order by "Circle", "Store Code" offset v_off limit v_limit) x), '[]')) into v;

  else  -- users: user list (Active / Inactive PAN India)
    with sc as (select store_id from public._scope()),
    q as (
      select p.full_name as "Full Name", p.employee_id as "Employee ID", p.email as "Email", p.mobile as "Mobile",
             case p.role when 'ADMIN' then 'Administrator' when 'CIRCLE_HEAD' then 'Circle Head' else 'Store User' end as "Role",
             case p.status when 'APPROVED' then 'Active' when 'REJECTED' then 'Rejected' else 'Pending Approval' end as "Status",
             st.code as "Store Code",
             (select string_agg(c.code, ', ' order by c.code) from public.circle_head_assignments a join public.circles c on c.id = a.circle_id where a.user_id = p.id) as "Circles",
             to_char(p.created_at at time zone 'Asia/Kolkata', 'YYYY-MM-DD') as "Registered On"
        from public.profiles p
        left join public.user_store_assignments usa on usa.user_id = p.id
        left join public.stores st on st.id = usa.store_id
       where (public.is_admin() or p.id = auth.uid()
              or usa.store_id in (select store_id from sc)
              or exists (select 1 from public.circle_head_assignments a join public.stores s2 on s2.circle_id = a.circle_id where a.user_id = p.id and s2.id in (select store_id from sc)))
         and (p_store is null or usa.store_id = p_store)
         and (p_circle is null or st.circle_id = p_circle or exists (select 1 from public.circle_head_assignments a where a.user_id = p.id and a.circle_id = p_circle)))
    select jsonb_build_object('total', (select count(*) from q),
      'rows', coalesce((select jsonb_agg(to_jsonb(x)) from (select * from q order by "Role", "Full Name" offset v_off limit v_limit) x), '[]')) into v;
  end if;

  if p_export and v_off = 0 then
    perform public.log_event('REPORT_EXPORTED', p_store, p_cycle, null, null,
      jsonb_build_object('report', p_report, 'rows', (v->>'total')::int, 'circle_id', p_circle, 'include_matched', coalesce(p_include_matched, false)));
  end if;
  return v;
end $$;
