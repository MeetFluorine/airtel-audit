-- =====================================================================
-- 38_reports_merged.sql | Report fixes (Oct 2026 QA): merged reports,
-- new columns, fixed labels, fixed User Report data flags.
-- Run once in the Supabase SQL editor (safe to re-run: create or replace).
-- This REPLACES report_rows() from migration 22 (same function, new
-- branches below). Run AFTER 22.
--
--   Merged (UI offers one report instead of several):
--     Store Summary  -> Pan-India Overview (gains Version, Last Updated)
--     Audit History  -> Store Audit Status (gains Started By, reopen
--                       columns, Circle Head, Overdue Days)
--     Serialized / Non-Serialized / Circle Shortage -> Consolidated
--                       Variance, via the Type filter (which reuses the
--                       serial / nonserial server branches) and the new
--                       p_variance_type filter (SHORT / EXCESS only).
--   Their old server branches are REMOVED here, except serial /
--   nonserial which the Type filter still calls.
--   New columns:
--     Variance + Store Audit Report: Type / In Transit (variance only,
--       store_audit already had them), Shortage Remark, Accepted Qty,
--       Revised Genuine Qty (from result_remarks, REVIEWED + accepted
--       only — pending remarks change nothing, same rule as ranking),
--       and Row Note on Store Audit Report (flags zero-qty MATCH rows).
--     Pan-India Overview: Version, Last Updated; shortage splits are
--       null for in-progress / not-started stores instead of a
--       misleading 0 (completed stores keep their real 0s) — the app
--       renders those nulls as '—', so the columns stay numeric.
--     Store Audit Status: Started By, Reopened By / At / Reason,
--       Circle Head, Overdue Days (0 once completed, else days past
--       the deadline; Deadline / Days Left unchanged).
--     Circle Summary: Status in Title Case (Healthy / Warning /
--       Critical / Pending — same _health() rule, only the casing
--       changes; the rule itself is now stated in the app's report
--       description).
--     Users: Data Flag (mechanical checks only: blank Employee ID /
--       Mobile, Employee ID containing '@', Email without '@' + '.').
--   Grand-total rows for Pan-India Overview and Circle Summary are
--   computed client-side in downloadReport(), not here, so the preview
--   paging can never corrupt them.
-- =====================================================================

create or replace function public.report_rows(p_report text, p_cycle uuid, p_circle uuid default null, p_store uuid default null,
                                              p_include_matched boolean default false, p_offset int default 0, p_limit int default 1000, p_export boolean default false,
                                              p_variance_type text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v jsonb; v_limit int := least(greatest(coalesce(p_limit, 1000), 1), 5000); v_off int := greatest(coalesce(p_offset, 0), 0);
begin
  if public.app_role() not in ('ADMIN','CIRCLE_HEAD') then raise exception 'You do not have permission to perform this action.' using errcode = '42501'; end if;
  if p_store is not null and not public.can_manage_store(p_store) then raise exception 'You do not have permission to perform this action.' using errcode = '42501'; end if;
  if p_report not in ('variance','serial','nonserial','circle_summary',
                      'store_audit','pan_india','store_status','users') then raise exception 'Unknown report.' using errcode = 'P0001'; end if;

  if p_report in ('variance','serial','nonserial') then
    with sc as (select s.id from public._scope() x join public.stores s on s.id = x.store_id where (p_circle is null or s.circle_id = p_circle) and (p_store is null or s.id = p_store)),
    ses as (select distinct on (x.store_id) x.* from public.audit_sessions x join sc on sc.id = x.store_id where x.audit_cycle_id = p_cycle and x.status = 'LOCKED' order by x.store_id, x.version desc),
    q as (
      select cy.name as "Audit Cycle", c.code as "Circle", st.code as "Store", r.item_code as "Item Code", r.inventory_status as "Inventory Status", r.item_description as "Item Description",
             r.item_uom as "UOM", r.item_quality as "Quality",
             case when r.is_serialized and r.result = 'SHORT' then r.item_sno end as "System Serial", case when r.is_serialized and r.result = 'EXCESS' then r.item_sno end as "Physical Serial",
             r.expected_qty as "Expected Qty", r.physical_qty as "Physical Qty", r.matched_qty as "Matched Qty", r.short_qty as "Short Qty", r.excess_qty as "Excess Qty",
             case when r.result = 'MATCH' then 'MATCH' when r.result = 'SHORT' then 'SHORT' when r.is_unlisted then 'EXCESS (UNLISTED)' else 'EXCESS' end as "Variance Type",
             to_char(ses.submitted_at at time zone 'Asia/Kolkata', 'YYYY-MM-DD') as "Audit Date", pr.full_name as "Submitted By",
             case when r.is_serialized then 'Serialized' else 'Non-Serialized' end as "Type",
             case when r.inventory_status ilike '%transit%' then 'Yes' else 'No' end as "In Transit",
             case when r.result = 'SHORT' then rm.rm_text end as "Shortage Remark",
             case when r.result = 'SHORT' then coalesce(rm.acc, 0) end as "Accepted Qty",
             case when r.result = 'SHORT' then greatest(r.short_qty - coalesce(rm.acc, 0), 0) end as "Revised Genuine Qty"
        from public.reconciliation_results r join ses on ses.id = r.session_id join public.stores st on st.id = r.store_id join public.circles c on c.id = st.circle_id
        join public.audit_cycles cy on cy.id = r.audit_cycle_id left join public.profiles pr on pr.id = ses.submitted_by
        left join lateral (select rr.remark as rm_text,
                                  case when rr.status = 'REVIEWED' and coalesce(rr.accepted_qty, 0) > 0 then least(rr.accepted_qty, r.short_qty) else 0 end as acc
                             from public.result_remarks rr
                            where rr.store_id = r.store_id and rr.audit_cycle_id = r.audit_cycle_id and rr.item_code = r.item_code
                              and rr.inventory_status = coalesce(r.inventory_status, '') and rr.item_quality = coalesce(r.item_quality, '')
                              and rr.item_sno = coalesce(r.item_sno, '')) rm on r.result = 'SHORT'
       where (coalesce(p_include_matched, false) or r.result <> 'MATCH')
         and (p_report = 'variance' or (p_report = 'serial' and r.is_serialized) or (p_report = 'nonserial' and not r.is_serialized))
         and (p_variance_type is null or (p_variance_type = 'SHORT' and r.result = 'SHORT') or (p_variance_type = 'EXCESS' and r.result = 'EXCESS')))
    select jsonb_build_object('total', (select count(*) from q),
      'rows', coalesce((select jsonb_agg(to_jsonb(x)) from (select * from q order by "Circle", "Store", "Variance Type", "Item Code", coalesce("System Serial", "Physical Serial") offset v_off limit v_limit) x), '[]')) into v;

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
             case public._health(case when g.expected > 0 then round(100 * g.matched / g.expected, 1) end, g.completed)
               when 'HEALTHY' then 'Healthy' when 'WARNING' then 'Warning' when 'CRITICAL' then 'Critical' when 'PENDING' then 'Pending' end as "Status" from g)
    select jsonb_build_object('total', (select count(*) from q),
      'rows', coalesce((select jsonb_agg(to_jsonb(x)) from (select * from q order by "Circle" offset v_off limit v_limit) x), '[]')) into v;

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
             to_char(ses.submitted_at at time zone 'Asia/Kolkata', 'YYYY-MM-DD') as "Audit Date", pr.full_name as "Submitted By",
             case when r.result = 'SHORT' then rm.rm_text end as "Shortage Remark",
             case when r.result = 'SHORT' then coalesce(rm.acc, 0) end as "Accepted Qty",
             case when r.result = 'SHORT' then greatest(r.short_qty - coalesce(rm.acc, 0), 0) end as "Revised Genuine Qty",
             case when r.result = 'MATCH' and coalesce(r.expected_qty, 0) = 0 and coalesce(r.physical_qty, 0) = 0 and coalesce(r.matched_qty, 0) = 0
                   and coalesce(r.short_qty, 0) = 0 and coalesce(r.excess_qty, 0) = 0 then 'Zero-qty MATCH (noise)' end as "Row Note"
        from public.reconciliation_results r join ses on ses.id = r.session_id join public.stores st on st.id = r.store_id join public.circles c on c.id = st.circle_id
        join public.audit_cycles cy on cy.id = r.audit_cycle_id left join public.profiles pr on pr.id = ses.submitted_by
        left join lateral (select rr.remark as rm_text,
                                  case when rr.status = 'REVIEWED' and coalesce(rr.accepted_qty, 0) > 0 then least(rr.accepted_qty, r.short_qty) else 0 end as acc
                             from public.result_remarks rr
                            where rr.store_id = r.store_id and rr.audit_cycle_id = r.audit_cycle_id and rr.item_code = r.item_code
                              and rr.inventory_status = coalesce(r.inventory_status, '') and rr.item_quality = coalesce(r.item_quality, '')
                              and rr.item_sno = coalesce(r.item_sno, '')) rm on r.result = 'SHORT')
    select jsonb_build_object('total', (select count(*) from q),
      'rows', coalesce((select jsonb_agg(to_jsonb(x)) from (select * from q order by "Type", "Result", "Item Code", "Serial No" offset v_off limit v_limit) x), '[]')) into v;

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
             case when d.audit_status = 'COMPLETED' then coalesce(a.t_transit, 0) end as "Short In Transit",
             case when d.audit_status = 'COMPLETED' then coalesce(a.t_other, 0) end as "Short Other",
             case when d.audit_status = 'COMPLETED' then coalesce(a.t_sser, 0) end as "Short Serialized",
             case when d.audit_status = 'COMPLETED' then coalesce(a.t_snon, 0) end as "Short Non-Serialized",
             d.excess as "Excess Units", d.match_rate as "Match Rate %",
             case d.audit_status when 'COMPLETED' then 'Completed' when 'IN_PROGRESS' then 'In Progress' else 'Not Started' end as "Audit Status",
             pr.full_name as "Submitted By", d.version as "Version",
             to_char(d.last_updated at time zone 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI') as "Last Updated"
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
             case when cy.deadline_at is null then null else ceil(extract(epoch from (cy.deadline_at - now())) / 86400)::int end as "Days Left",
             p0.full_name as "Started By",
             p3.full_name as "Reopened By", to_char(s.reopened_at at time zone 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI') as "Reopened At", s.reopen_reason as "Reopen Reason",
             (select string_agg(p.full_name, ', ' order by p.full_name) from public.circle_head_assignments a join public.profiles p on p.id = a.user_id and p.status = 'APPROVED' and p.role = 'CIRCLE_HEAD' where a.circle_id = d.circle_id) as "Circle Head",
             case when d.audit_status = 'COMPLETED' then 0 when cy.deadline_at is null then null
                  else greatest(0, ceil(extract(epoch from (now() - cy.deadline_at)) / 86400))::int end as "Overdue Days"
        from public._dash_rows(p_cycle) d join sc on sc.id = d.store_id join public.audit_cycles cy on cy.id = p_cycle
        left join public.audit_sessions s on s.id = d.session_id left join public.profiles pr on pr.id = s.submitted_by
        left join public.profiles p0 on p0.id = s.started_by left join public.profiles p3 on p3.id = s.reopened_by)
    select jsonb_build_object('total', (select count(*) from q),
      'rows', coalesce((select jsonb_agg(to_jsonb(x)) from (select * from q order by "Circle", "Store Code" offset v_off limit v_limit) x), '[]')) into v;

  else  -- users: user list (PAN India)
    with sc as (select store_id from public._scope()),
    q as (
      select p.full_name as "Full Name", p.employee_id as "Employee ID", p.email as "Email", p.mobile as "Mobile",
             case p.role when 'ADMIN' then 'Administrator' when 'CIRCLE_HEAD' then 'Circle Head' else 'Store User' end as "Role",
             case p.status when 'APPROVED' then 'Active' when 'REJECTED' then 'Rejected' else 'Pending Approval' end as "Status",
             st.code as "Store Code",
             (select string_agg(c.code, ', ' order by c.code) from public.circle_head_assignments a join public.circles c on c.id = a.circle_id where a.user_id = p.id) as "Circles",
             to_char(p.created_at at time zone 'Asia/Kolkata', 'YYYY-MM-DD') as "Registered On",
             nullif(concat_ws('; ',
               case when coalesce(btrim(p.employee_id), '') = '' then 'Employee ID missing' end,
               case when p.employee_id like '%@%' then 'Employee ID looks like an email' end,
               case when p.email is null or p.email not like '%@%.%' then 'Email looks incomplete' end,
               case when coalesce(btrim(p.mobile), '') = '' then 'Mobile missing' end), '') as "Data Flag"
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
