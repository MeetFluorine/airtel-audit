Shadowfax Airtel Store Audit Tracker  -  UI fix pass (no new SQL in this update)

DATABASE: nothing new to run. Already run: 01, 03 - 11 (11_redesign.sql is required for the new UI).
  (02_seed_and_tests.sql is DEV ONLY)

APP (static, no build step): upload index.html, css/, js/, assets/ to Netlify (same site > Deploys).
  Then hard-refresh the page (Ctrl+Shift+R) so the browser drops the old CSS/JS.
  Never put the service_role key in this repo.

BANNER: assets/banner.jpg is your supplied image. To change it later, replace that one file (keep the name).
  It is used on the store dashboard hero and on the login / register left panel.
