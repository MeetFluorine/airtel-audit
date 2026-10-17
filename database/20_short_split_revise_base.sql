-- =====================================================================
-- 20_short_split_revise_base.sql
--   1) result_summary(): adds the shortage split (in-transit vs other status). Nothing else about the numbers changes.
--   2) ADMIN can replace the whole base stock of any store at any time, even after its audit started or finished.
-- Run once in the Supabase SQL Editor (after 19; safe to re-run).
--
-- Replace rules (freeze_base_stock):
--   * Admin: always allowed. The new upload replaces the store's entire base stock for that cycle.
--       - audit IN PROGRESS: it continues, measured against the new base (scans are re-checked against it).
--       - audit COMPLETED:   its results are re-compared against the new base stock and the totals are updated.
--       - older reopened versions keep the base they were audited with (history is preserved).
--   * Circle Head: still only until the store's audit starts.
--   * Store user: only the first upload of an open cycle (unchanged).
--   The change is written to the audit log (BASE_FROZEN with replaced_after_audit = true).
-- =====================================================================

-- ---------- 1) result_summary + shortage split ----------
create or replace function public.result_summary(p_session uuid) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'expected', coalesce(sum(expected_qty), 0), 'physical', coalesce(sum(physical_qty), 0), 'matched', coalesce(sum(matched_qty), 0),
    'short', coalesce(sum(short_qty), 0), 'excess', coalesce(sum(excess_qty), 0),
    'match_rate', case when coalesce(sum(expected_qty), 0) > 0 then round(100 * sum(matched_qty) / sum(expected_qty), 1) else null end,
    'rows_all', count(*), 'rows_match', count(*) filter (where result = 'MATCH'),
    'rows_short', count(*) filter (where result = 'SHORT'), 'rows_excess', count(*) filter (where result = 'EXCESS'),
    'short_transit', coalesce(sum(short_qty) filter (where result = 'SHORT' and inventory_status ilike '%transit%'), 0),
    'short_other',   coalesce(sum(short_qty) filter (where result = 'SHORT' and not (coalesce(inventory_status, '') ilike '%transit%')), 0))
  from public.reconciliation_results where session_id = p_session
$$;

-- ---------- 2) freeze_base_stock: admin can replace at any time ----------
create or replace function public.freeze_base_stock(p_upload_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare u public.base_stock_uploads; n int; ser int; nsq numeric; v_prev boolean; v_any boolean; v_done int := 0; v_live int := 0; r record; v jsonb;
begin
  select * into u from public.base_stock_uploads where id = p_upload_id for update;
  if not found or not public.can_setup_base(u.store_id) then
    raise exception 'You do not have permission to perform this action.' using errcode = '42501'; end if;
  if u.status <> 'DRAFT' then raise exception 'Only a draft upload can be frozen.' using errcode = 'P0001'; end if;
  select count(*), count(*) filter (where item_sno is not null), coalesce(sum(item_qnty) filter (where item_sno is null), 0) into n, ser, nsq
    from public.base_stock where upload_id = p_upload_id;
  if n = 0 then raise exception 'The upload has no rows.' using errcode = 'P0001'; end if;
  if exists (select 1 from public.base_stock where upload_id = p_upload_id and btrim(item_code) = '') then
    raise exception 'The upload contains blank item codes.' using errcode = 'P0001'; end if;
  v_prev := exists (select 1 from public.base_stock_uploads where audit_cycle_id = u.audit_cycle_id and store_id = u.store_id and status = 'FROZEN');
  v_any  := exists (select 1 from public.audit_sessions where audit_cycle_id = u.audit_cycle_id and store_id = u.store_id);
  if not public.can_manage_store(u.store_id) then          -- store user: first upload of an open cycle only
    if v_prev then raise exception 'Base data is already uploaded for this store. Ask your Circle Head or Admin to revise it.' using errcode = '42501'; end if;
    if (select status::text from public.audit_cycles where id = u.audit_cycle_id) is distinct from 'ACTIVE' then
      raise exception 'This audit cycle is closed. Base data can only be set up for an open cycle.' using errcode = '42501'; end if;
  end if;
  if v_prev and v_any and not public.is_admin() then       -- circle head: not once the audit has started
    raise exception 'An audit has already started for this store. Only an Admin can replace the base stock now.' using errcode = '42501'; end if;

  update public.base_stock_uploads set status = 'SUPERSEDED' where audit_cycle_id = u.audit_cycle_id and store_id = u.store_id and status = 'FROZEN';
  update public.base_stock_uploads
     set status = 'FROZEN', frozen_by = auth.uid(), frozen_at = now(), rows_valid = n, serialized_count = ser, non_serialized_count = n - ser, expected_units = ser + nsq,
         version = coalesce((select max(version) from public.base_stock_uploads where audit_cycle_id = u.audit_cycle_id and store_id = u.store_id and id <> u.id), 0) + 1
   where id = p_upload_id;
  insert into public.audit_cycle_stores(audit_cycle_id, store_id, active_upload_id, frozen_at) values (u.audit_cycle_id, u.store_id, p_upload_id, now())
  on conflict (audit_cycle_id, store_id) do update set active_upload_id = excluded.active_upload_id, frozen_at = excluded.frozen_at;

  -- admin replaced the base after the audit started / finished: move the live audit onto the new base
  if v_prev and v_any then
    perform set_config('app.bypass_guard', 'on', true);
    update public.audit_sessions set base_upload_id = p_upload_id
     where audit_cycle_id = u.audit_cycle_id and store_id = u.store_id and status in ('IN_PROGRESS', 'LOCKED');
    -- audit still running: re-check each scanned serial against the new base
    update public.audit_serial_scans sc
       set is_unlisted = not exists (select 1 from public.base_stock b where b.upload_id = p_upload_id and b.item_sno = sc.item_sno)
     where sc.session_id in (select id from public.audit_sessions where audit_cycle_id = u.audit_cycle_id and store_id = u.store_id and status = 'IN_PROGRESS');
    get diagnostics v_live = row_count;
    -- audit completed: compare the stored scans / counts again, against the new base
    for r in select id from public.audit_sessions where audit_cycle_id = u.audit_cycle_id and store_id = u.store_id and status = 'LOCKED' loop
      delete from public.reconciliation_results where session_id = r.id;
      perform public._reconcile(r.id);
      v := public.result_summary(r.id);
      update public.audit_sessions set expected_units = (v->>'expected')::numeric, physical_units = (v->>'physical')::numeric, matched_units = (v->>'matched')::numeric,
             short_units = (v->>'short')::numeric, excess_units = (v->>'excess')::numeric where id = r.id;
      v_done := v_done + 1;
    end loop;
    perform set_config('app.bypass_guard', 'off', true);
  end if;

  perform public.log_event('BASE_FROZEN', u.store_id, u.audit_cycle_id, null, p_upload_id,
          jsonb_build_object('rows', n, 'serialized', ser, 'non_serialized', n - ser, 'replaced_after_audit', v_prev and v_any, 'results_recomputed', v_done));
end $$;
