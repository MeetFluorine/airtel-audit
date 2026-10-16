-- =====================================================================
-- 16_result_remarks.sql | Optional remarks on SHORT items of a submitted audit.
-- Run after 15_management_signup.sql (safe to run again).
--
--   set_result_remark(session, item_code, status, quality, serial_no, remark)
--       The store user of that store writes (or edits / clears) a remark on a SHORT item of their SUBMITTED audit.
--       An empty remark deletes it. Max 500 characters.
--   Everyone who can see the store (store user, its Circle Head, Admin) can READ the remarks (table is read-only for the app).
--
-- Remarks are saved against the item itself (store + cycle + item + status + quality + serial), not against one submitted version,
-- so they are still there if an administrator reopens the audit and the store submits it again.
-- =====================================================================
create table if not exists public.result_remarks (
  id               uuid primary key default gen_random_uuid(),
  store_id         uuid not null references public.stores(id) on delete cascade,
  audit_cycle_id   uuid not null references public.audit_cycles(id) on delete cascade,
  item_code        text not null,
  inventory_status text not null default '',
  item_quality     text not null default '',
  item_sno         text not null default '',
  remark           text not null check (char_length(remark) between 1 and 500),
  updated_by       uuid references public.profiles(id) on delete set null,
  updated_at       timestamptz not null default now(),
  unique (store_id, audit_cycle_id, item_code, inventory_status, item_quality, item_sno)
);
alter table public.result_remarks enable row level security;
drop policy if exists remarks_read on public.result_remarks;
create policy remarks_read on public.result_remarks for select to authenticated using (public.can_see_store(store_id));
revoke all on public.result_remarks from anon, authenticated;
grant select on public.result_remarks to authenticated;

create or replace function public.set_result_remark(p_session uuid, p_item_code text, p_status text, p_quality text, p_sno text, p_remark text) returns void
language plpgsql security definer set search_path = '' as $$
declare s public.audit_sessions; r text := btrim(coalesce(p_remark, '')); v_st text := coalesce(p_status, ''); v_q text := coalesce(p_quality, ''); v_sn text := coalesce(p_sno, '');
begin
  s := public._session_for(p_session, false);                      -- store users only, and only their own store's audit
  if s.status <> 'LOCKED' then raise exception 'Remarks can be added once the audit is submitted, on the current result.' using errcode = 'P0001'; end if;
  if char_length(r) > 500 then raise exception 'Remarks can be at most 500 characters.' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.reconciliation_results x
                  where x.session_id = s.id and x.result = 'SHORT' and x.item_code = p_item_code
                    and coalesce(x.inventory_status, '') = v_st and coalesce(x.item_quality, '') = v_q and coalesce(x.item_sno, '') = v_sn) then
    raise exception 'Remarks can only be added to short items.' using errcode = 'P0001';
  end if;
  if r = '' then
    delete from public.result_remarks where store_id = s.store_id and audit_cycle_id = s.audit_cycle_id and item_code = p_item_code
       and inventory_status = v_st and item_quality = v_q and item_sno = v_sn;
  else
    insert into public.result_remarks(store_id, audit_cycle_id, item_code, inventory_status, item_quality, item_sno, remark, updated_by)
    values (s.store_id, s.audit_cycle_id, p_item_code, v_st, v_q, v_sn, r, auth.uid())
    on conflict (store_id, audit_cycle_id, item_code, inventory_status, item_quality, item_sno)
    do update set remark = excluded.remark, updated_by = excluded.updated_by, updated_at = now();
  end if;
end $$;
revoke execute on function public.set_result_remark(uuid, text, text, text, text, text) from public, anon;
grant execute on function public.set_result_remark(uuid, text, text, text, text, text) to authenticated;
