Shadowfax Airtel Store Audit Tracker  -  admin Dashboard redesign (no new SQL)
CHANGED: Dashboard menu for Admin / Circle Head only (js/dashboard.js adminDash, css/admin-dashboard.css, 1 link in index.html, 1 subtitle line in js/app.js). All other pages untouched.

DATABASE: nothing new to run. Already run: 01, 03 - 11.
APP (static, no build step): upload index.html, css/, js/, assets/ to Netlify (same site > Deploys),
  then hard-refresh (Ctrl+Shift+R). Never put the service_role key in this repo.
BANNER: assets/banner.jpg (your supplied image). Replace that one file to change it everywhere.


---- Store audit page: "what is left to audit" checklist ----
1) Run database/12_audit_checklist.sql once in the Supabase SQL editor (safe to re-run).
2) Upload the files as usual. Changed: js/audit.js, css/audit-checklist.css (new), index.html (1 link).
Until step 1 is done the audit page works exactly as before; the checklist just stays hidden.


---- Dashboard: click-to-filter, menu order ----
1) Run database/13_dashboard_filter.sql once in the Supabase SQL editor (safe to re-run). It lets the two trend charts follow the selected circle head / circle.
   Without it the dashboard still filters; only the trend charts keep showing all circles (a small note says so).
2) Changed: js/dashboard.js, js/app.js (menu order + Dashboard subtitle), css/admin-dashboard.css.

---- Permanent account deletion ----
1) Run database/14_delete_account.sql once in the Supabase SQL editor (safe to re-run). Until it is run, the Delete buttons show an error when used.
2) Changed: js/account.js (My Account / My Profile), js/admin.js (Users page), js/ui.js (shared dialog), js/reports.js (log label),
   css/danger-zone.css (new), index.html (1 link).

---- Sign-up: Store level / Management level ----
1) Run database/15_management_signup.sql once in the Supabase SQL editor (after 14; safe to re-run). Until it is run, management sign-ups cannot be stored as requests.
2) Changed: js/app.js (chooser + two forms + waiting screen), js/admin.js (Users page: approve management requests),
   css/signup-choice.css (new), index.html (1 link).
A management sign-up never grants a role by itself: an existing Admin approves it on the Users page.

---- Circle head circle cards, result sub-filter, remarks, cycle history ----
1) Run database/16_result_remarks.sql once in the Supabase SQL editor (after 15; safe to re-run). Without it the result page works as before, just without the remarks boxes.
2) Changed: js/dashboard.js (circle cards for Circle Heads), js/audit.js (result sub-filter, remarks, old-cycle result, cycle history),
   js/app.js (Audit Cycle chip for store users), css/result-extras.css (new), css/admin-dashboard.css, index.html.
Viewing old cycle results needs no SQL: store users could already read their own store's sessions and results.
