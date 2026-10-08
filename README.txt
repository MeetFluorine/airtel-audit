Shadowfax Airtel Store Audit Tracker  -  Phase 1 + Phase 2a

DATABASE (Supabase SQL Editor, run in this order)
  1. database/01_schema.sql        tables, RLS, triggers, auth functions
  2. database/03_real_data.sql     42 stores / 12 circles (+ promote yourself to ADMIN: edit the commented line)
  3. database/04_phase2.sql        freeze + report-name functions
  (02_seed_and_tests.sql is DEV ONLY - do not run it in production)

APP (static files, no build step)
  Open a terminal in this folder and run:   python3 -m http.server 5500
  Then open:                                http://localhost:5500

HOSTING
  Upload this folder's contents (index.html, css/, js/) to a GitHub repo and enable Pages.
  Then set Supabase > Authentication > URL Configuration > Site URL to the live address.
  Never put the service_role key in this repo.
