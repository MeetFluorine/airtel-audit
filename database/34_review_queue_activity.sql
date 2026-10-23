-- ============================================================================
-- 34 · Shortage Review redesign support: review_queue gains last_activity
-- (latest remark activity for the store in this cycle, else the session's
-- submission time) for the Overview tab's "Last Updated" column.
-- Identical to database/32 otherwise. Safe to re-run. Run AFTER 32.
-- ============================================================================

create or replace function public.review_queue(p_cycle uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v jsonb;
begin
  if public.app_role() not in ('ADMIN','CIRCLE_HEAD') then
    raise exception 'You do not have permission to perform this action.' using errcode = '42501'; end if;
  with latest as (
    select distinct on (s.store_id) s.id as session_id, s.store_id
      from public.audit_sessions s
     where s.audit_cycle_id = p_cycle and s.status = 'LOCKED'
       and s.store_id in (select store_id from public._scope())
     order by s.store_id, s.version desc
  ), rows_g as (
    select l.store_id, l.session_id, r.item_code, coalesce(r.inventory_status, '') as ist,
           coalesce(r.item_quality, '') as iq, coalesce(r.item_sno, '') as sno, r.short_qty
      from latest l join public.reconciliation_results r on r.session_id = l.session_id
     where r.result = 'SHORT' and not (coalesce(r.inventory_status, '') ilike '%transit%')
  ), ent as (
    select g.store_id, rr.category_id,
           least(coalesce(rr.qty, g.short_qty), g.short_qty) as eff_qty,
           case when rr.status = 'REVIEWED' then least(coalesce(rr.accepted_qty, 0), g.short_qty) else 0 end as acc_qty,
           rr.status
      from rows_g g
      join public.result_remarks rr on rr.store_id = g.store_id and rr.audit_cycle_id = p_cycle
       and rr.item_code = g.item_code and rr.inventory_status = g.ist and rr.item_quality = g.iq and rr.item_sno = g.sno
  ), per_store as (
    select l.store_id, l.session_id,
           (select coalesce(sum(short_qty), 0) from rows_g g where g.store_id = l.store_id) as reported,
           (select coalesce(sum(eff_qty), 0) from ent e where e.store_id = l.store_id) as claimed,
           (select coalesce(sum(acc_qty), 0) from ent e where e.store_id = l.store_id) as accepted,
           (select count(*)::int from ent e where e.store_id = l.store_id and e.status = 'PENDING') as pending_n,
           (select count(*)::int from ent e where e.store_id = l.store_id) as entries_n
      from latest l
  ), grp as (
    select e.store_id, e.category_id, coalesce(sum(e.eff_qty), 0) as claimed, coalesce(sum(e.acc_qty), 0) as accepted,
           count(*)::int as entries_n, count(*) filter (where e.status = 'PENDING')::int as pending_n
      from ent e group by e.store_id, e.category_id
  )
  select coalesce(jsonb_agg(x order by x->>'circle', x->>'code'), '[]'::jsonb) into v from (
    select jsonb_build_object(
      'session_id', p.session_id, 'store_id', p.store_id, 'code', st.code, 'name', st.name, 'circle', ci.code,
      'reported', p.reported, 'claimed', p.claimed, 'accepted', p.accepted,
      'revised', greatest(p.reported - p.accepted, 0), 'pending_entries', p.pending_n, 'entries', p.entries_n,
      'last_activity', coalesce((select max(rr.updated_at) from public.result_remarks rr where rr.store_id = p.store_id and rr.audit_cycle_id = p_cycle), (select s2.submitted_at from public.audit_sessions s2 where s2.id = p.session_id)),
      'groups', (select coalesce(jsonb_agg(jsonb_build_object('category_id', g.category_id, 'category', coalesce(cat.name, 'Free text only'),
                    'claimed', g.claimed, 'accepted', g.accepted, 'entries', g.entries_n, 'pending', g.pending_n)
                    order by cat.sort nulls last, coalesce(cat.name, 'Free text only')), '[]'::jsonb)
                   from grp g left join public.remark_categories cat on cat.id = g.category_id where g.store_id = p.store_id)
    ) as x
    from per_store p join public.stores st on st.id = p.store_id join public.circles ci on ci.id = st.circle_id
    where p.reported > 0 or p.entries_n > 0
  ) t;
  return jsonb_build_object('stores', coalesce(v, '[]'::jsonb));
end $$;
revoke execute on function public.review_queue(uuid) from public, anon;
grant execute on function public.review_queue(uuid) to authenticated;
