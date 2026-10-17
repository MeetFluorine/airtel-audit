---- Store result page redesign (matches the approved mockup) ----
No new SQL. Changed: js/audit.js (result page), js/colfilter.js (small label fix), css/result-table.css (rewritten).
Summary card: donut with match rate, Expected / Found / Short (with In transit / Other split) / Excess, and coloured pills.
Table: fixed percentage column widths, text wraps, so it always fits the page width (no sideways scrolling; only phones under 1000px can scroll as a last resort).
Columns: # | Item Code | Description | Status | UoM | Expected | Physical | Variance | Quality | Item SNo | Result | Remarks (remarks box in the same row).
Footer: "Showing 1-50 of 102 rows (Filtered from 497)" with page numbers. The page now scrolls normally, header row stays on top.

---- Column filters in the Admin / Circle Head store view ----
No new SQL (uses database/19_result_filter_values.sql from before; without it the tick-lists become "contains" boxes).
Changed: js/colfilter.js (new, shared filter code), js/audit.js (result page now uses it), js/dashboard.js (store detail: Variance Details, Serialized Items, Non-Serialized Items tabs), index.html (1 script).
Click the funnel in any column header: tick values, type text, or set a From/To range. Active filters show as chips with Clear all.

---- In-transit shortage shown separately + Admin can replace base stock any time ----
1) Re-run database/18_ranking.sql, then run database/20_short_split_revise_base.sql once (after 19; both safe to re-run).
2) Changed: database/18 + 20, js/ranking.js, js/audit.js + js/dashboard.js (Short split), js/basestock.js (replace messaging), css/result-table.css.
Audit data is NOT changed: Expected / Short / Excess / match rate show exactly as audited. The Short figure now has a sub-line "In transit X . Other Y".
Ranking tables show Short (all), In transit and Other status separately. Points use matched / (matched + other-status shortage); the tie-break is the counted shortage %.
Base stock: uploading a new file for a store REPLACES its entire base stock. Admin can do this at any time, even after the audit started or finished:
  audit in progress -> continues against the new base; audit completed -> its results are re-compared against the new base and the totals updated.
Circle Head can still replace only until the store's audit starts. Store users: first upload only.

---- Result page layout, column filters, in-transit rule ----
1) Re-run database/18_ranking.sql (it now leaves In-Transit shortages out of the ranking) and run database/19_result_filter_values.sql once. Both are safe to re-run.
   Without 19 everything still works; the Item_Code / Inventory_Status / UoM / Quality filters just become a "contains" box.
2) Changed: js/audit.js (new result page), css/result-table.css (new), js/dashboard.js (Inventory status + Quality columns in the admin / circle head store view),
   js/ranking.js (note about in-transit), index.html (1 link).
Result page (store user): no Back button, compact summary strip on top, full-width item table with the Remarks box in the same row of each short item.
Column filters: click the funnel in any column header (tick values, type text, or set a From/To range). Active filters show as chips with Clear all.
Ranking: a SHORT line whose Inventory_Status contains "transit" is NOT removed from the audit data. It is shown as a separate figure (see next section).

---- Ranking (store, circle, pan-India) ----
1) Run database/18_ranking.sql once in the Supabase SQL editor (after 17; safe to re-run). Until it is run, the Ranking page shows an error.
2) Changed: js/ranking.js (new), css/ranking.css (new), js/app.js (Ranking menu item + allowed page), index.html (1 link + 1 script).
Points per completed cycle = 20 (participation) + match rate % (max 120). Missed cycle = 0. Rank = total points, tie-break lowest shortage %. Circle rank = average points per store.
To change the weights edit only _rank_points() at the top of 18_ranking.sql and re-run the file.
Store user: own circle + India rank. Circle head: his stores' circle + India rank. Admin: all stores, all circles, top store per circle.

---- Close a cycle any time (Admin) + store users can set up their own base data ----
1) Run database/17_close_cycle_store_base.sql once in the Supabase SQL editor (after 16; safe to re-run). Until it is run, the Close cycle button and the new Base Data page show an error.
2) Changed: js/cycle.js (Close cycle button in the sidebar), js/basedata.js (new: store user Base Data page), js/app.js (menu + allowed page), js/audit.js (2 hint lines),
   js/dashboard.js + js/reports.js (log label), css/cycle-base.css (new), index.html (1 link + 1 script).
Close cycle: Admin only. Store users can no longer start or continue audits in a closed cycle; all data stays. It cannot be reopened from the app.
Base Data (store user): own store only, open cycle only, FIRST upload only. After it is frozen, only Admin / Circle Head can revise it (Operations > Base Stock). Store users still cannot read base stock rows.

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
