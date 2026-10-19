-- =====================================================================
-- 25_perf_indexes.sql | Missing indexes behind the slow dashboard / page loads.
--
-- What was slow: several per-session lookups had NO index, so every page
-- load ran sequential scans over the (large) scan/entry tables, e.g.
--   * _counts(session)            -> store dashboard, audit page (4 scans)
--   * _dash_rows live units       -> staff dashboard, per IN_PROGRESS store (4 scans each)
--   * audit_sessions by (cycle, store) without a status filter -> store detail page
-- With these indexes those become index scans. No behaviour change.
--
-- Run once in the Supabase SQL editor (safe to re-run).
-- Run after 24_stock_shortage_breakdown.sql (order does not really matter).
-- =====================================================================

create index if not exists audit_serial_scans_session_idx
  on public.audit_serial_scans(session_id);

create index if not exists audit_non_serial_entries_session_idx
  on public.audit_non_serial_entries(session_id);

-- the existing partial index one_live_session_per_store(audit_cycle_id, store_id)
-- only helps lookups filtered to IN_PROGRESS/LOCKED; this one covers the rest
create index if not exists audit_sessions_cycle_store_idx
  on public.audit_sessions(audit_cycle_id, store_id);

-- result page tabs + the store variance report filter by (session, result)
create index if not exists reconciliation_results_session_result_idx
  on public.reconciliation_results(session_id, result);

-- let the planner pick the new indexes up immediately
analyze public.audit_serial_scans;
analyze public.audit_non_serial_entries;
analyze public.audit_sessions;
analyze public.reconciliation_results;
