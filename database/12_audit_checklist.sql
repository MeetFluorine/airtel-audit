-- =====================================================================
-- 12_audit_checklist.sql | "What is left to audit" checklist for the store user.
-- Run after 11_redesign.sql (safe to run again).
-- Gives the store user, for THEIR OWN open session only:
--   serial : how many serial numbers are expected in their base stock, how many they have scanned, and the same split item code by item code
--   non    : the non-serialized item codes (item + status + quality) they still have to count, and which are already done
-- Still blind where it matters: NO non-serialized quantity is ever returned, and no serial numbers are listed.
-- =====================================================================
create or replace function public.audit_checklist(p_session uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s public.audit_sessions; v_ser jsonb; v_non jsonb;
begin
  s := public._session_for(p_session, false);

  with b as (
    select item_code, min(item_description) as descr, count(*) as expected
      from public.base_stock
     where upload_id = s.base_upload_id and item_sno is not null
     group by item_code),
  sc as (
    select item_code, count(*) filter (where not is_unlisted) as found
      from public.audit_serial_scans
     where session_id = s.id
     group by item_code)
  select jsonb_build_object(
           'expected', coalesce(sum(b.expected), 0),
           'found',    coalesce(sum(coalesce(sc.found, 0)), 0),
           'extra',    (select count(*) from public.audit_serial_scans where session_id = s.id and is_unlisted),
           'items',    coalesce(jsonb_agg(jsonb_build_object('item_code', b.item_code, 'description', b.descr,
                                                              'expected', b.expected, 'scanned', coalesce(sc.found, 0))
                                          order by (b.expected - coalesce(sc.found, 0)) desc, b.item_code), '[]'::jsonb))
    into v_ser
    from b left join sc on sc.item_code = b.item_code;

  with l as (
    select item_code, coalesce(inventory_status, '') as st, coalesce(item_quality, '') as q,
           min(item_description) as descr, min(item_uom) as uom
      from public.base_stock
     where upload_id = s.base_upload_id and item_sno is null
     group by item_code, coalesce(inventory_status, ''), coalesce(item_quality, '')),
  e as (
    select item_code, inventory_status as st, item_quality as q
      from public.audit_non_serial_entries
     where session_id = s.id),
  j as (
    select l.*, exists (select 1 from e where e.item_code = l.item_code and e.st = l.st and e.q = l.q) as done
      from l)
  select jsonb_build_object(
           'total', count(*),
           'done',  count(*) filter (where done),
           'extra', (select count(*) from e where not exists (select 1 from l where l.item_code = e.item_code and l.st = e.st and l.q = e.q)),
           'lines', coalesce(jsonb_agg(jsonb_build_object('item_code', item_code, 'inventory_status', st, 'item_quality', q,
                                                          'item_description', descr, 'item_uom', uom, 'done', done)
                                       order by done, item_code, st, q), '[]'::jsonb))
    into v_non
    from j;

  return jsonb_build_object('serial', v_ser, 'non', v_non);
end $$;
grant execute on function public.audit_checklist(uuid) to authenticated;
