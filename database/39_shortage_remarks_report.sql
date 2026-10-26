-- =====================================================================
-- 39_shortage_remarks_report.sql | Shortage Remarks report (Oct 2026)
-- New downloadable report: every shortage row except in-transit,
-- store-wise, with the full remark (category + reference + note) and
-- its review outcome. Built from the approved mockup
-- (MOCKUP_Shortage_Remarks_Report.xlsx).
-- Standalone function: does NOT depend on migrations 37/38. Run once
-- in the Supabase SQL editor (safe to re-run: create or replace).
-- Deploy the app code first, then run this.
--   Grain: one row per shortage item (serialized = one system serial,
--   non-serialized = one item aggregate), ordered store-wise.
--   Remark join keys match report_rows() and review_entries() exactly
--   (store, cycle, item, status, quality, serial) — the unique key on
--   result_remarks, so at most one remark per row.
--   Review Status: No Remark (no remark filed) · Pending (filed, not
--   reviewed) · Accepted (accepted >= claimed) · Partially Accepted
--   (0 < accepted < claimed) · Not Accepted (reviewed, accepted 0).
--   Revised Genuine = short − accepted (reviewed only); pending remarks
--   change nothing, same rule as ranking.
--   Reviewer Role casts profiles.role to text first: it is the user_role
--   ENUM, and mixing it with text literals in a CASE makes Postgres cast
--   the literals to the enum — fails with 22P02 on '—' (no reviewer) and
--   on 'Admin'/'Circle Head' (not enum members).
--   Scoping matches report_rows(): _scope() + can_manage_store(), so a
--   Circle Head only ever receives their own circles.
-- =====================================================================

create or replace function public.shortage_remarks_rows(p_cycle uuid, p_circle uuid default null, p_store uuid default null,
                                                       p_offset int default 0, p_limit int default 1000, p_export boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v jsonb; v_limit int := least(greatest(coalesce(p_limit, 1000), 1), 5000); v_off int := greatest(coalesce(p_offset, 0), 0);
begin
  if public.app_role() not in ('ADMIN','CIRCLE_HEAD') then raise exception 'You do not have permission to perform this action.' using errcode = '42501'; end if;
  if p_store is not null and not public.can_manage_store(p_store) then raise exception 'You do not have permission to perform this action.' using errcode = '42501'; end if;

  with sc as (select s.id from public._scope() x join public.stores s on s.id = x.store_id where (p_circle is null or s.circle_id = p_circle) and (p_store is null or s.id = p_store)),
  ses as (select distinct on (x.store_id) x.* from public.audit_sessions x join sc on sc.id = x.store_id where x.audit_cycle_id = p_cycle and x.status = 'LOCKED' order by x.store_id, x.version desc),
  q as (
    select cy.name as "Audit Cycle", c.code as "Circle", st.code as "Store Code", st.name as "Store Name",
           r.item_code as "Item Code", r.item_description as "Item Description",
           case when r.is_serialized then 'Serialized' else 'Non-Serialized' end as "Type",
           case when r.is_serialized then r.item_sno else '—' end as "System Serial",
           r.short_qty as "Short Qty",
           case when rm.id is null then '—' else coalesce(cat.name, 'Free text only') end as "Remark Category",
           coalesce(rm.reference, '—') as "Reference",
           coalesce(rm.note, '—') as "Note",
           case when rm.id is null then null else least(coalesce(rm.qty, r.short_qty), r.short_qty) end as "Claimed Qty",
           rm.accepted as "Accepted Qty",
           case when rm.id is null then 'No Remark'
                when rm.status = 'PENDING' then 'Pending'
                when coalesce(rm.accepted, 0) = 0 then 'Not Accepted'
                when rm.accepted >= least(coalesce(rm.qty, r.short_qty), r.short_qty) then 'Accepted'
                else 'Partially Accepted' end as "Review Status",
           coalesce(rv.full_name, '—') as "Reviewed By",
           case rv.role::text when 'ADMIN' then 'Admin' when 'CIRCLE_HEAD' then 'Circle Head' else coalesce(rv.role::text, '—') end as "Reviewer Role",
           case when rm.reviewed_at is null then '—' else to_char(rm.reviewed_at at time zone 'Asia/Kolkata', 'YYYY-MM-DD') end as "Reviewed On",
           greatest(r.short_qty - case when rm.status = 'REVIEWED' then coalesce(rm.accepted, 0) else 0 end, 0) as "Revised Genuine Qty"
      from public.reconciliation_results r join ses on ses.id = r.session_id join public.stores st on st.id = r.store_id join public.circles c on c.id = st.circle_id
      join public.audit_cycles cy on cy.id = r.audit_cycle_id
      left join lateral (select rr.id, rr.category_id, rr.reference, rr.remark as note, rr.qty, rr.status, rr.accepted_qty as accepted, rr.reviewed_by, rr.reviewed_at
                           from public.result_remarks rr
                          where rr.store_id = r.store_id and rr.audit_cycle_id = r.audit_cycle_id and rr.item_code = r.item_code
                            and rr.inventory_status = coalesce(r.inventory_status, '') and rr.item_quality = coalesce(r.item_quality, '')
                            and rr.item_sno = coalesce(r.item_sno, '')) rm on true
      left join public.remark_categories cat on cat.id = rm.category_id
      left join public.profiles rv on rv.id = rm.reviewed_by
     where r.result = 'SHORT' and not (coalesce(r.inventory_status, '') ilike '%transit%'))
  select jsonb_build_object('total', (select count(*) from q),
    'rows', coalesce((select jsonb_agg(to_jsonb(x)) from (select * from q order by "Circle", "Store Code", "Item Code", "System Serial" offset v_off limit v_limit) x), '[]')) into v;

  if p_export and v_off = 0 then
    perform public.log_event('REPORT_EXPORTED', p_store, p_cycle, null, null,
      jsonb_build_object('report', 'shortage_remarks', 'rows', (v->>'total')::int, 'circle_id', p_circle));
  end if;
  return v;
end $$;

revoke execute on function public.shortage_remarks_rows(uuid, uuid, uuid, int, int, boolean) from public, anon;
grant execute on function public.shortage_remarks_rows(uuid, uuid, uuid, int, int, boolean) to authenticated;
