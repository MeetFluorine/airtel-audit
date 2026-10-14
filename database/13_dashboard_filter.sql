-- =====================================================================
-- 13_dashboard_filter.sql | Circle-filtered trend for the Dashboard (click a circle head / circle to filter).
-- Run after 12_audit_checklist.sql (safe to run again). Same output as dash_trend(), limited to the given circle codes.
-- Until it is run, a filtered Dashboard still works; only the two trend charts keep showing all circles.
-- =====================================================================
create or replace function public.dash_trend_circles(p_cycle uuid, p_limit int, p_circles text[]) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if public.app_role() not in ('ADMIN','CIRCLE_HEAD') then raise exception 'You do not have permission to perform this action.' using errcode = '42501'; end if;
  return (
    with sc2 as (
      select sc.store_id from public._scope() sc
        join public.stores st on st.id = sc.store_id
        join public.circles ci on ci.id = st.circle_id
       where ci.code = any(p_circles))
    select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at), '[]'::jsonb) from (
      select c.id, c.name, c.created_at, (select count(*) from sc2) as stores,
             count(ses.id) filter (where ses.status = 'LOCKED') as completed, count(ses.id) filter (where ses.status = 'IN_PROGRESS') as in_progress,
             coalesce(sum(ses.expected_units) filter (where ses.status = 'LOCKED'), 0) as expected, coalesce(sum(ses.matched_units) filter (where ses.status = 'LOCKED'), 0) as matched,
             coalesce(sum(ses.short_units) filter (where ses.status = 'LOCKED'), 0) as short, coalesce(sum(ses.excess_units) filter (where ses.status = 'LOCKED'), 0) as excess
        from (select * from public.audit_cycles where created_at <= (select created_at from public.audit_cycles where id = p_cycle) order by created_at desc limit greatest(p_limit, 1)) c
        left join lateral (select distinct on (s.store_id) s.* from public.audit_sessions s join sc2 on sc2.store_id = s.store_id
                            where s.audit_cycle_id = c.id and s.status in ('IN_PROGRESS','LOCKED') order by s.store_id, s.version desc) ses on true
       group by c.id, c.name, c.created_at) t);
end $$;
revoke execute on function public.dash_trend_circles(uuid, int, text[]) from public, anon;
grant execute on function public.dash_trend_circles(uuid, int, text[]) to authenticated;
