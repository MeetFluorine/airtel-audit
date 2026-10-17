-- =====================================================================
-- 21_new_reports.sql | Five new report types for the Reports page.
-- Run once in the Supabase SQL editor (safe to re-run: create or replace).
--
-- New p_report values for public.report_rows():
--   store_audit     - one store's full reconciliation: overview + variance,
--                     every line (matched, short, excess) split by
--                     Serialized / Non-Serialized, with an In-Transit flag.
--                     Requires p_store.
--   circle_shortage - shortage lines only, store-wise, for one circle.
--                     Requires p_circle.
--   pan_india       - one row per store for the cycle: expected / physical /
--                     matched / short (split: in-transit, other, serialized,
--                     non-serialized) / excess / match rate / status.
--   store_status    - one row per store: Completed / In Progress / Not Started,
--                     version, started / submitted timestamps and user.
--   users           - user list (Active / Inactive PAN India): name, employee
--                     id, contact, role, store / circles, status.
--
-- Security: same as before - staff only, and only stores the caller manages
-- (a Circle Head never receives another circle's rows, even by calling the
-- function directly). The p_export log event is unchanged.
-- =====================================================================

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
             pr.full_name as "Submitted By", d.match_rate as "Match Rate %"
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
