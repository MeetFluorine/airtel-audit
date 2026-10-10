-- =====================================================================
-- 08_typeahead.sql | Item-code type-ahead for the non-serialized count.
-- Run after 07_phase4.sql. Replaces lookup_item: as the store user types (2+ characters) it returns up to 10
-- matching non-serialized lines (item code, status, quality, description, UoM) from THEIR store's frozen base.
-- Still blind: no quantities are ever returned. Exact matches are listed first, then "starts with", then "contains".
-- =====================================================================
create or replace function public.lookup_item(p_session uuid, p_code text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s public.audit_sessions; v text := upper(btrim(p_code)); v_opts jsonb; v_ser boolean;
begin
  s := public._session_for(p_session, false);
  if v is null or length(v) < 2 then
    return jsonb_build_object('options', '[]'::jsonb, 'serialized_only', false, 'exact', true); end if;
  select coalesce(jsonb_agg(to_jsonb(y) - 'rank' order by y.rank, y.item_code, y.inventory_status, y.item_quality), '[]') into v_opts from (
    select item_code, inventory_status, item_quality, min(item_description) as item_description, min(item_uom) as item_uom,
           min(case when upper(item_code) = v then 0 when starts_with(upper(item_code), v) then 1 else 2 end) as rank
      from public.base_stock
     where upload_id = s.base_upload_id and item_sno is null and strpos(upper(item_code), v) > 0
     group by item_code, inventory_status, item_quality
     order by 6, 1, 2, 3 limit 10) y;
  if jsonb_array_length(v_opts) = 0 then
    select exists (select 1 from public.base_stock where upload_id = s.base_upload_id and item_sno is not null and strpos(upper(item_code), v) > 0) into v_ser;
    return jsonb_build_object('options', '[]'::jsonb, 'serialized_only', v_ser, 'exact', true);
  end if;
  return jsonb_build_object('options', v_opts, 'serialized_only', false, 'exact', true);
end $$;
grant execute on function public.lookup_item(uuid, text) to authenticated;
