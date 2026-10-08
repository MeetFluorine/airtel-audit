-- =====================================================================
-- 02_seed_and_tests.sql  |  DEV ONLY - do not run the test block in production
-- =====================================================================

-- ---------- reference seed (DEV ONLY) ---------------------------------
-- In production, circles and stores are maintained by the admin (Stores page, Phase 2).
-- A store's circle is whatever the admin assigns here - it is NEVER read from the stock
-- Excel (the Substore_Circle column is ignored). stores.code must equal Substore_Name.
-- The signup dropdown reads this same list via public_store_list().
insert into public.circles(code, name) values
  ('RAJ','Rajasthan'), ('UPW','UP West'), ('UPE','UP East'), ('HAR','Haryana'), ('MPCG','MP & Chhattisgarh')
on conflict (code) do nothing;

insert into public.stores(code, name, circle_id)
select v.code, v.name, c.id from (values
  ('SFX_JODHPUR','Jodhpur','RAJ'), ('SFX_JAIPUR','Jaipur','RAJ'),
  ('SFX_KOTA','Kota','RAJ'),       ('SFX_AJMER','Ajmer','RAJ')) v(code,name,circ)
join public.circles c on c.code = v.circ
on conflict (code) do nothing;

-- ---------- bootstrap the FIRST admin ---------------------------------
-- 1) Create the user in Supabase Dashboard > Authentication > Users (or sign up in the app).
-- 2) Then run (replace the email). Profiles can't be edited from the browser, so this is the only way in:
--
--   update public.profiles set role = 'ADMIN', status = 'APPROVED' where email = 'you@company.com';
--
-- Further admins / circle heads: use  select public.admin_set_role('<user-uuid>', 'CIRCLE_HEAD');
-- then insert into public.circle_head_assignments(user_id, circle_id) ...

-- =====================================================================
-- RLS TESTS  (run as postgres in the SQL editor; everything is rolled back)
-- Each block impersonates a user. EXPECT lines say what must happen.
-- =====================================================================
begin;

-- fixtures -------------------------------------------------------------
insert into auth.users(id, email, raw_user_meta_data) values
 ('00000000-0000-0000-0000-0000000000a1','admin@t.io','{"full_name":"Admin"}'),
 ('00000000-0000-0000-0000-0000000000c1','ch@t.io','{"full_name":"CH"}'),
 ('00000000-0000-0000-0000-0000000000b1','rahul@t.io',
   jsonb_build_object('full_name','Rahul','store_id',(select id from public.stores where code='SFX_JODHPUR'),'role','ADMIN'));
-- ^ metadata tries to smuggle role=ADMIN: EXPECT profile role = STORE_USER, status = PENDING
select role, status from public.profiles where email='rahul@t.io';

update public.profiles set role='ADMIN', status='APPROVED' where email='admin@t.io';
update public.profiles set role='CIRCLE_HEAD', status='APPROVED' where email='ch@t.io';
insert into public.circle_head_assignments select '00000000-0000-0000-0000-0000000000c1', id from public.circles where code='UPW';

insert into public.audit_cycles(id,name,start_date,end_date,status,created_by)
 values ('11111111-1111-1111-1111-111111111111','TEST-CYCLE',current_date,current_date+7,'ACTIVE','00000000-0000-0000-0000-0000000000a1');
insert into public.base_stock_uploads(id,audit_cycle_id,store_id,status)
 select '22222222-2222-2222-2222-222222222222','11111111-1111-1111-1111-111111111111',id,'DRAFT' from public.stores where code='SFX_JODHPUR';
insert into public.base_stock(upload_id,audit_cycle_id,store_id,item_code,item_qnty,item_sno)
 select '22222222-2222-2222-2222-222222222222','11111111-1111-1111-1111-111111111111',id,'ITEM1',1,'SN001' from public.stores where code='SFX_JODHPUR';
update public.base_stock_uploads set status='FROZEN' where id='22222222-2222-2222-2222-222222222222';   -- freeze AFTER rows are loaded

-- approve Rahul to Jodhpur as admin
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-0000000000a1"}',true);
select public.approve_user('00000000-0000-0000-0000-0000000000b1',(select id from public.stores where code='SFX_JODHPUR'));

-- T1 store user: EXPECT 0 rows from base_stock, 1 store (own), 0 events
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-0000000000b1"}',true);
select 'T1 base_stock rows (expect 0)' t, count(*) from public.base_stock;
select 'T1 stores visible (expect 1)'  t, count(*) from public.stores;
select 'T1 events visible (expect 0)'  t, count(*) from public.audit_events;
-- T2 store user cannot write directly: EXPECT permission denied
do $$ begin
  begin insert into public.audit_serial_scans(session_id,item_sno,item_code) values (gen_random_uuid(),'X','Y');
        raise notice 'T2 FAIL: insert allowed'; exception when others then raise notice 'T2 ok: %', sqlerrm; end;
  begin update public.profiles set role='ADMIN' where id = auth.uid();
        raise notice 'T2b FAIL: self-promote allowed'; exception when others then raise notice 'T2b ok: %', sqlerrm; end;
end $$;

-- T3 circle head for UPW (no stores there): EXPECT 0 stores, 0 base rows, cannot approve for RAJ store
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-0000000000c1"}',true);
select 'T3 stores visible (expect 0)' t, count(*) from public.stores;
select 'T3 base rows (expect 0)'      t, count(*) from public.base_stock;
do $$ begin
  begin perform public.change_user_store('00000000-0000-0000-0000-0000000000b1',(select id from public.stores where code='SFX_JAIPUR'));
        raise notice 'T3 FAIL'; exception when others then raise notice 'T3 ok: %', sqlerrm; end;
end $$;

-- T4 admin: EXPECT sees base row; frozen base cannot be edited
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-0000000000a1"}',true);
select 'T4 admin base rows (expect 1)' t, count(*) from public.base_stock;
do $$ begin
  begin delete from public.base_stock; raise notice 'T4 FAIL: frozen delete allowed'; exception when others then raise notice 'T4 ok: %', sqlerrm; end;
end $$;
reset role;

-- T5 locked-session immutability (as owner): EXPECT 'Audit is already locked.'
insert into public.audit_sessions(id,audit_cycle_id,store_id,base_upload_id,started_by,status)
 select '33333333-3333-3333-3333-333333333333','11111111-1111-1111-1111-111111111111',id,'22222222-2222-2222-2222-222222222222',
        '00000000-0000-0000-0000-0000000000b1','LOCKED' from public.stores where code='SFX_JODHPUR';
do $$ begin
  begin insert into public.audit_serial_scans(session_id,item_sno,item_code) values ('33333333-3333-3333-3333-333333333333','SN001','ITEM1');
        raise notice 'T5 FAIL'; exception when others then raise notice 'T5 ok: %', sqlerrm; end;
end $$;

rollback;   -- leaves no test data behind
