-- =====================================================================
-- 30_level_gates.sql | Tightened store level gates (owner's revision,
--   Oct 2026). Replaces ONLY _store_level() from migration 29 - run this
--   once if you already ran 29. Fresh setups can skip it: migration 29
--   already carries these gates.
--     Champion : completion 100% , match >  99% , shortage <= 0.05%, no late submission
--     Diamond  : completion 100% , match >= 99% , shortage <= 0.5%
--     Platinum : completion >= 90%, match >= 98% , shortage <= 1.5%
--     Gold     : completion >= 80%, match >= 97% , shortage <= 2%
--     Silver   : completion >= 65%, match >= 90% , shortage <= 5%
--     Bronze   : completion >= 50%, match >= 85% , shortage <= 8%
--   otherwise: Unranked. Safe to re-run.
-- =====================================================================

create or replace function public._store_level(p_done int, p_held int, p_match numeric, p_short numeric, p_late int) returns text
language sql immutable set search_path = '' as $$
  select case
    when coalesce(p_held, 0) <= 0 or coalesce(p_done, 0) <= 0 or p_match is null then 'Unranked'
    when p_done >= p_held and p_match > 99 and p_short <= 0.05 and coalesce(p_late, 0) = 0 then 'Champion'
    when p_done >= p_held and p_match >= 99 and p_short <= 0.5 then 'Diamond'
    when p_done * 10 >= p_held * 9 and p_match >= 98 and p_short <= 1.5 then 'Platinum'
    when p_done * 5 >= p_held * 4 and p_match >= 97 and p_short <= 2 then 'Gold'
    when p_done * 20 >= p_held * 13 and p_match >= 90 and p_short <= 5 then 'Silver'
    when p_done * 2 >= p_held and p_match >= 85 and p_short <= 8 then 'Bronze'
    else 'Unranked' end $$;

revoke execute on function public._store_level(int, int, numeric, numeric, int) from public, anon, authenticated;
