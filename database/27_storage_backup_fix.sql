-- =====================================================================
-- 27_storage_backup_fix.sql
--   Store-user base-data saves ended with "Rows saved, but the original
--   file backup failed." The rows were fine; the Excel backup upload to
--   the base-stock-files bucket was rejected by storage RLS:
--     * the bucket never had an UPDATE policy, which the client's
--       upsert-style upload needs, and
--     * this re-asserts the store-user INSERT policy from migration 17
--       so the live database definitely has it.
--   File path layout: <cycle>/<store>/<upload>.<ext> (segment 2 = store).
-- Run once in the Supabase SQL Editor, after 26_cycle_close_rules.sql (safe to re-run).
-- =====================================================================

-- a store user may add the backup file for their OWN store (staff: stores they manage)
drop policy if exists bsf_insert on storage.objects;
create policy bsf_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'base-stock-files' and public.can_setup_base(public.try_uuid(split_part(name,'/',2))));

-- same right for UPDATE, so upsert-style uploads work too
drop policy if exists bsf_update on storage.objects;
create policy bsf_update on storage.objects for update to authenticated
  using (bucket_id = 'base-stock-files' and public.can_setup_base(public.try_uuid(split_part(name,'/',2))))
  with check (bucket_id = 'base-stock-files' and public.can_setup_base(public.try_uuid(split_part(name,'/',2))));
