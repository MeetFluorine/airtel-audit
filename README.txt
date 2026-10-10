Shadowfax Airtel Store Audit Tracker  -  through Phase 4 (reconciliation, lock, reopen)

DATABASE (Supabase SQL Editor). Already run: 01, 03, 04, 05, 06.
  NEW - run now:  database/07_phase4.sql     (reconciliation, submit & lock, results, reopen)
  (02_seed_and_tests.sql is DEV ONLY)

APP (static, no build step): upload index.html, css/, js/ to Netlify (same site > Deploys).
  Never put the service_role key in this repo.

TEST ORDER: store user submits an audit -> sees result -> admin opens Audit Cycles > cycle > View result / Reopen / History.
