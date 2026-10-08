-- =====================================================================
-- 03_real_data.sql  |  Real circles + stores (42 stores, 12 circles)
-- Safe to re-run (upserts). Run in the Supabase SQL Editor AFTER 01_schema.sql.
-- Do NOT run the dev seed in 02_seed_and_tests.sql (SFX_JODHPUR etc.).
-- =====================================================================

-- Optional: the name this store carries in the stock report's Substore_Name column.
-- Left NULL until you know it; the upload wizard compares the file against
-- coalesce(report_name, code) and WARNS (admin can override) on a mismatch.
alter table public.stores add column if not exists report_name text;

-- Circles. Names for BHJ, NESA, ROM, UN-HAR are placeholders (= code); the others are best guesses.
-- Correct any of them later:  update public.circles set name = '...' where code = '...';
insert into public.circles(code, name) values
  ('BHJ', 'BHJ'),
  ('MPCG', 'Madhya Pradesh & Chhattisgarh'),
  ('NESA', 'NESA'),
  ('RAJ', 'Rajasthan'),
  ('ROM', 'ROM'),
  ('UN-HAR', 'UN-HAR'),
  ('TN', 'Tamil Nadu'),
  ('KER', 'Kerala'),
  ('UPE', 'UP East'),
  ('KK', 'Karnataka'),
  ('ORS', 'Odisha'),
  ('WB', 'West Bengal')
on conflict (code) do update set name = excluded.name;

-- Stores: code = SFX_Store ID exactly as supplied (case-sensitive); circle from your list.
insert into public.stores(code, name, circle_id)
select v.code, v.name, c.id from (values
  ('IXR_DS_Ranchi', 'Ranchi', 'BHJ'),
  ('IDR_DS_Tilaknagar', 'Tilaknagar', 'MPCG'),
  ('BPL_DS_Chunabhatti', 'Chunabhatti', 'MPCG'),
  ('BAP_DS_Bilaspur', 'Bilaspur', 'MPCG'),
  ('BIA_DS_Bhilai', 'Bhilai', 'MPCG'),
  ('HBD_DS_Narmadapuram', 'Narmadapuram', 'MPCG'),
  ('RTM_DS_Ratlam', 'Ratlam', 'MPCG'),
  ('MDS_DS_Mandsaur', 'Mandsaur', 'MPCG'),
  ('GWL_DS_Gwalior', 'Gwalior', 'MPCG'),
  ('SCL_DS_Silchar', 'Silchar', 'NESA'),
  ('BTE_DS_Bharatpur', 'Bharatpur', 'RAJ'),
  ('UDR_DS_KhedaCircle', 'Kheda Circle', 'RAJ'),
  ('PTRD_DS_Bhiwadi', 'Bhiwadi', 'RAJ'),
  ('Jai_DS_ShastriNagar', 'Shastri Nagar', 'RAJ'),
  ('Jai_DS_KarniVihar', 'Karni Vihar', 'RAJ'),
  ('JDP_DS_MahaveerNagar', 'Mahaveer Nagar', 'RAJ'),
  ('KOT_DS_Kota', 'Kota', 'RAJ'),
  ('ANG_DS_Savedi', 'Savedi', 'ROM'),
  ('NGP_DS_Wardhman', 'Wardhman', 'ROM'),
  ('KOP_DS_MangalwarPeth', 'Mangalwar Peth', 'ROM'),
  ('HTK_DS_Sangli', 'Sangli', 'ROM'),
  ('AK_DS_Akola', 'Akola', 'ROM'),
  ('KKDE_DS_Kurukshetra', 'Kurukshetra', 'UN-HAR'),
  ('YJUD_DS_Yamunagar', 'Yamunagar', 'UN-HAR'),
  ('HAR_DS_Panchkula', 'Panchkula', 'UN-HAR'),
  ('CBE_DS_Comibatore', 'Coimbatore', 'TN'),
  ('COK_DS_Cochin', 'Cochin', 'KER'),
  ('MDU_DS_Sellur', 'Sellur', 'TN'),
  ('JHS_DS_Jhansi', 'Jhansi', 'UPE'),
  ('CHN_DS_Avadi', 'Avadi', 'TN'),
  ('BLR_DS_JPNagar', 'JP Nagar', 'KK'),
  ('BLR_DS_Sarjapur', 'Sarjapur', 'KK'),
  ('Jai_DS_Muralipura', 'Muralipura', 'RAJ'),
  ('SME_DS_Shivamogga', 'Shivamogga', 'KK'),
  ('CHN_DS_Velacherry', 'Velacherry', 'TN'),
  ('CHN_DS_Vadapalani', 'Vadapalani', 'TN'),
  ('CBE_DS_Podanur', 'Podanur', 'TN'),
  ('CBE_DS_Kalapatti', 'Kalapatti', 'TN'),
  ('CTC_DS_Cuttack', 'Cuttack', 'ORS'),
  ('CCU_DS_Belgharia', 'Belgharia', 'WB'),
  ('BLR_DS_Kengeri', 'Kengeri', 'KK'),
  ('BLR_DS_Yelahanka', 'Yelahanka', 'KK')
) v(code, name, circ)
join public.circles c on c.code = v.circ
on conflict (code) do update set name = excluded.name, circle_id = excluded.circle_id, active = true;

-- If you accidentally ran the dev seed, remove its demo stores (only works while nothing references them):
-- delete from public.stores where code in ('SFX_JODHPUR','SFX_JAIPUR','SFX_KOTA','SFX_AJMER');

-- Promote YOUR account (create the user first in Authentication > Users). Replace the email, then run:
-- update public.profiles set role = 'ADMIN', status = 'APPROVED' where email = 'YOUR_EMAIL_HERE';

-- Verify
select c.code as circle, count(s.id) as stores from public.circles c left join public.stores s on s.circle_id = c.id
group by c.code order by c.code;      -- expect 42 stores in total
