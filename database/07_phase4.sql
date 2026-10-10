-- =====================================================================
-- 07_phase4.sql | Reconciliation engine, submit & lock, results, admin reopen (versions).
-- Run after 06_phase3.sql.
--
-- Counting rules
--   Serialized  : every base serial = 1 expected unit. Scanned & in base = MATCH; in base, not scanned = SHORT;
--                 scanned, not in this store's base = EXCESS (unlisted). Never matched to another store.
--   Non-serial  : grouped by (item code, inventory status, quality).
--                 matched = MIN(expected, physical)  short = MAX(expected - physical, 0)  excess = MAX(physical - expected, 0)
--   Match rate  : sum(matched) / sum(expected), in units.
-- =====================================================================

-- ---------- internal: build the reconciliation rows for one session ------------
create or replace function public._reconcile(p_session uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare s public.audit_sessions;
begin
  select * into s from public.audit_sessions where id = p_session;

  -- serialized: every serial in this store's frozen base
  insert into public.reconciliation_results(session_id, audit_cycle_id, store_id, item_code, inventory_status, item_description, item_uom, item_quality, item_sno,
                                            is_serialized, is_unlisted, expected_qty, physical_qty, matched_qty, short_qty, excess_qty, result)
  select p_session, s.audit_cycle_id, s.store_id, b.item_code, b.inventory_status, b.item_description, b.item_uom, b.item_quality, b.item_sno,
         true, false, 1, (sc.id is not null)::int, (sc.id is not null)::int, (sc.id is null)::int, 0,
         case when sc.id is not null then 'MATCH' else 'SHORT' end
    from public.base_stock b
    left join public.audit_serial_scans sc on sc.session_id = p_session and sc.item_sno = b.item_sno
   where b.upload_id = s.base_upload_id and b.item_sno is not null;

  -- serialized: scanned but not in this store's base -> EXCESS
  insert into public.reconciliation_results(session_id, audit_cycle_id, store_id, item_code, inventory_status, item_description, item_uom, item_quality, item_sno,
                                            is_serialized, is_unlisted, expected_qty, physical_qty, matched_qty, short_qty, excess_qty, result)
  select p_session, s.audit_cycle_id, s.store_id, sc.item_code, null, d.item_description, d.item_uom, null, sc.item_sno, true, true, 0, 1, 0, 0, 1, 'EXCESS'
    from public.audit_serial_scans sc
    left join lateral (select item_description, item_uom from public.base_stock b where b.upload_id = s.base_upload_id and upper(b.item_code) = upper(sc.item_code) limit 1) d on true
   where sc.session_id = p_session
     and not exists (select 1 from public.base_stock b where b.upload_id = s.base_upload_id and b.item_sno = sc.item_sno);

  -- non-serialized
  with base_ns as (
    select upper(item_code) k_code, coalesce(inventory_status, '') k_st, coalesce(item_quality, '') k_q,
           min(item_code) item_code, min(inventory_status) inv, min(item_description) d, min(item_uom) u, min(item_quality) q, sum(item_qnty) exp
      from public.base_stock where upload_id = s.base_upload_id and item_sno is null group by 1, 2, 3),
  phys as (
    select upper(item_code) k_code, inventory_status k_st, item_quality k_q, max(item_code) item_code, sum(physical_qty) p
      from public.audit_non_serial_entries where session_id = p_session group by 1, 2, 3)
  insert into public.reconciliation_results(session_id, audit_cycle_id, store_id, item_code, inventory_status, item_description, item_uom, item_quality, item_sno,
                                            is_serialized, is_unlisted, expected_qty, physical_qty, matched_qty, short_qty, excess_qty, result)
  select p_session, s.audit_cycle_id, s.store_id, coalesce(b.item_code, ph.item_code), coalesce(b.inv, nullif(ph.k_st, '')), coalesce(b.d, d.item_description), coalesce(b.u, d.item_uom),
         coalesce(b.q, nullif(ph.k_q, '')), null, false, (b.k_code is null),
         coalesce(b.exp, 0), coalesce(ph.p, 0), least(coalesce(b.exp, 0), coalesce(ph.p, 0)),
         greatest(coalesce(b.exp, 0) - coalesce(ph.p, 0), 0), greatest(coalesce(ph.p, 0) - coalesce(b.exp, 0), 0),
         case when coalesce(b.exp, 0) > coalesce(ph.p, 0) then 'SHORT' when coalesce(ph.p, 0) > coalesce(b.exp, 0) then 'EXCESS' else 'MATCH' end
    from base_ns b
    full join phys ph on ph.k_code = b.k_code and ph.k_st = b.k_st and ph.k_q = b.k_q
    left join lateral (select item_description, item_uom from public.base_stock x where x.upload_id = s.base_upload_id and upper(x.item_code) = ph.k_code limit 1) d on b.k_code is null;
end $$;
revoke execute on function public._reconcile(uuid) from public, anon, authenticated;

-- ---------- KPIs (security INVOKER: row-level security decides who can see what) ----------
create or replace function public.result_summary(p_session uuid) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'expected', coalesce(sum(expected_qty), 0), 'physical', coalesce(sum(physical_qty), 0), 'matched', coalesce(sum(matched_qty), 0),
    'short', coalesce(sum(short_qty), 0), 'excess', coalesce(sum(excess_qty), 0),
    'match_rate', case when coalesce(sum(expected_qty), 0) > 0 then round(100 * sum(matched_qty) / sum(expected_qty), 1) else null end,
    'rows_all', count(*), 'rows_match', count(*) filter (where result = 'MATCH'),
    'rows_short', count(*) filter (where result = 'SHORT'), 'rows_excess', count(*) filter (where result = 'EXCESS'))
  from public.reconciliation_results where session_id = p_session
$$;

-- ---------- submit & lock ----------------------------------------------
create or replace function public.submit_audit(p_session uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s public.audit_sessions;
begin
  s := public._session_for(p_session, true);                                  -- store user, own store, IN_PROGRESS
  select * into s from public.audit_sessions where id = p_session for update;  -- serialize double-clicks
  if s.status <> 'IN_PROGRESS' then raise exception 'Audit is already locked.' using errcode = '42501'; end if;
  if (public._counts(p_session)->>'units')::numeric = 0 then
    raise exception 'Add at least one item before completing the audit.' using errcode = 'P0001'; end if;
  perform public.log_event('AUDIT_SUBMITTED', s.store_id, s.audit_cycle_id, s.id, s.id, public._counts(p_session));
  update public.audit_sessions set status = 'LOCKED', submitted_by = auth.uid(), submitted_at = now() where id = p_session;
  perform public._reconcile(p_session);
  perform public.log_event('AUDIT_LOCKED', s.store_id, s.audit_cycle_id, s.id, s.id, '{}');
  return public.result_summary(p_session);
end $$;

-- ---------- admin / circle head: reopen as a NEW version (history preserved) ----------
create or replace function public.reopen_audit(p_session uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s public.audit_sessions; n public.audit_sessions;
begin
  select * into s from public.audit_sessions where id = p_session for update;
  if not found or not public.can_manage_store(s.store_id) then
    raise exception 'You do not have permission to perform this action.' using errcode = '42501'; end if;
  if s.status <> 'LOCKED' then raise exception 'Only a locked audit can be reopened.' using errcode = 'P0001'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 5 then
    raise exception 'Please enter a reason for reopening (at least 5 characters).' using errcode = 'P0001'; end if;

  update public.audit_sessions set status = 'REOPENED' where id = s.id;        -- old version stays as history
  insert into public.audit_sessions(audit_cycle_id, store_id, version, status, base_upload_id, started_by, reopened_from, reopened_by, reopened_at, reopen_reason)
  values (s.audit_cycle_id, s.store_id, (select max(version) + 1 from public.audit_sessions where audit_cycle_id = s.audit_cycle_id and store_id = s.store_id),
          'IN_PROGRESS', s.base_upload_id, s.started_by, s.id, auth.uid(), now(), btrim(p_reason))
  returning * into n;
  -- the store continues from what was already counted
  insert into public.audit_serial_scans(session_id, audit_cycle_id, store_id, item_sno, item_code, is_unlisted, scanned_by, scanned_at)
    select n.id, n.audit_cycle_id, n.store_id, item_sno, item_code, is_unlisted, scanned_by, scanned_at from public.audit_serial_scans where session_id = s.id;
  insert into public.audit_non_serial_entries(session_id, audit_cycle_id, store_id, item_code, inventory_status, item_quality, physical_qty, created_by, created_at)
    select n.id, n.audit_cycle_id, n.store_id, item_code, inventory_status, item_quality, physical_qty, created_by, created_at from public.audit_non_serial_entries where session_id = s.id;
  perform public.log_event('AUDIT_REOPENED', s.store_id, s.audit_cycle_id, n.id, s.id,
          jsonb_build_object('reason', btrim(p_reason), 'from_version', s.version, 'new_version', n.version));
  return jsonb_build_object('session_id', n.id, 'version', n.version);
end $$;

-- ---------- context now also tells the store why an audit was reopened ----------
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
    'cycle', case when cy.id is null then null else jsonb_build_object('id', cy.id, 'name', cy.name) end,
    'session', case when s.id is null then null else jsonb_build_object('id', s.id, 'version', s.version, 'status', s.status, 'submitted_at', s.submitted_at,
                                                                         'reopen_reason', s.reopen_reason, 'reopened_at', s.reopened_at) end,
    'counts', case when s.id is null then null else public._counts(s.id) end);
end $$;

grant execute on function public.result_summary(uuid), public.submit_audit(uuid), public.reopen_audit(uuid,text) to authenticated;
