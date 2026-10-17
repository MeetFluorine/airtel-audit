=====================================================================
Shadowfax Airtel Store Audit Tracker
=====================================================================
Live app : https://meetfluorine.github.io/airtel-audit
Repo     : https://github.com/MeetFluorine/airtel-audit

WHAT IT IS
  Physical stock audit app for Airtel stores run by Shadowfax. Store teams
  count serialized stock (barcode scan) and non-serialized stock against an
  uploaded base file; the app reconciles expected vs physical, scores each
  store (match rate + participation points) and ranks stores and circles.

WHO USES IT
  Store User   - uploads base data once (frozen after), scans/counts stock,
                 previews, submits and locks the audit. Sees only own store.
  Circle Head  - dashboards, results, rankings and reports for their circles.
  Admin        - everything: users, stores, circles, cycles, base data,
                 reports, audit logs.

TECH
  Frontend: static site - HTML, CSS, vanilla JavaScript. No build step, no
            framework; host it anywhere static (GitHub Pages, Netlify...).
  Backend:  Supabase - Postgres with Row Level Security on everything, Auth,
            Storage (base-stock Excel backups). The public anon key lives in
            js/supabase.js; all permission checks run in SECURITY DEFINER
            Postgres functions, never in the browser.

SETUP
  1) In the Supabase SQL editor run database/*.sql in numeric order, once
     each (every file is safe to re-run). Skip 02_seed_and_tests.sql on a
     real project - it is demo data. Run 21 before 22.
  2) Serve this folder with any static host. No server code to deploy.

CHANGELOG (newest first)
---------------------------------------------------------------------

---- Layout fixes: ranking cards, result summary ----
No SQL. Changed: css/global.css, css/result-table.css, js/audit.js.
Ranking page: the five stat cards now stretch to fill the full row width (grid auto-fit instead of auto-fill).
Result page summary card (v5, per mockup): restructured - top row has the donut (130px, vertically centered) beside the four KPIs in one horizontal row; ALL pills sit in ONE single row spanning the full card width from the left edge (no longer confined to the right column, no second row). Compact pill styling: smaller padding, 15px icons, bold numbers. Overall card height reduced.

---- 3-day audit deadlines with escalation ----
1) Run database/22_audit_deadlines.sql once in the Supabase SQL editor (after 21; safe to re-run).
2) Changed: database/22_audit_deadlines.sql (new), js/cycle.js, js/audit.js, js/dashboard.js, js/reports.js.
Rule: every audit cycle gets a deadline 3 days after creation (stamped automatically; existing cycles backfilled as created_at + 3 days).
Escalation surfaces:
  Store user dashboard: banner - "X days left" (info), "Due today/tomorrow" (warning), "Overdue by X days" (red). Hidden once submitted.
  Sidebar: cycle widget shows "Due <date> - N days left" / overdue; progress line shows "N overdue".
  Staff dashboard: red "Overdue" badge on pending stores + a new "Overdue" tab with count.
  Store Status report: new "Deadline" and "Days Left" columns (negative = days overdue).
Creating a cycle tells the admin stores get 3 days. Nothing is auto-locked at the deadline - it is enforced by visibility, so no audit is ever lost.

---- New report types + Generate Report modal ----
1) Run database/21_new_reports.sql once in the Supabase SQL editor (safe to re-run; it replaces the report_rows function, keeping all existing reports working).
2) Changed: database/21_new_reports.sql (new), js/reports.js.
Reports page: a "Generate Report" button (top right) opens a modal like the mockup - pick a report type from a grouped dropdown, set Circle / Store, then Generate & Download. Store Audit Report needs a store, Circle Shortage Report needs a circle (the modal and the preview both say so).
New report types (all download as .xlsx, previewable, scope-safe: a Circle Head only ever gets their own circles):
  Store Audit Report - one store's full reconciliation: overview + variance, every line (matched, short, excess) split by Serialized / Non-Serialized, with an In-Transit flag.
  Circle Shortage Report - shortage lines only, store-wise, for the selected circle.
  Pan-India Audit Overview - one row per store for the cycle: expected / physical / matched / short (split into in-transit, other, serialized, non-serialized) / excess / match rate / status.
  Store Audit Status - who completed and who is pending: Completed / In Progress / Not Started per store, with version, started/submitted times and match rate.
  User Report (Active / Inactive PAN India) - every user: contact, role, store / circles, approval status.
Tabs reorganised: Audit Reports (Store Audit, Store Summary, Audit History), Variance Reports (+ Circle Shortage), Overview Reports (Pan-India, Store Status, Circle Summary), User Reports, Audit Logs.

---- Centered tables ----
No SQL. New css/table-center.css (+ 1 link in index.html, loaded last): headings and values are centered in every table (admin and circle head lists, dashboards, result table, ranking tables, checklist, recent scans). Other text keeps its alignment.

---- Ranking page polish ----
No SQL. Changed: js/ranking.js, css/ranking.css.
Ranking tables (Stores, Circles): sorting only (click a heading: A to Z / Z to A, low to high / high to low, third click clears); the column filter funnels are removed.
Columns use percentage widths and wrap, so the tables fit the page with no sideways scrolling (phones under 1000px may still scroll).
Top store of each circle: compact cards, ordered by the store's all-India rank (best first; ties by circle rank, then circle name).

---- Raj_SS_Temp filter, gap-free ranking, sortable ranking tables, new top-store card ----
1) Re-run database/18_ranking.sql in the Supabase SQL editor (safe to re-run). No other SQL.
2) Changed: database/18_ranking.sql, js/basestock.js, js/basedata.js, js/colfilter.js, js/ranking.js, css/ranking.css.
Base data upload: every row whose Substore_Name is Raj_SS_Temp (any case) is dropped before any other check (never counted, never a duplicate, ignored by the store-name check).
  The validation screen shows "Raj_SS_Temp removed N". To drop more sub-stores, add them to BS_SKIP_SUBSTORES at the top of js/basestock.js.
Ranking numbers: dense ranking 1, 2, 3 (two stores sharing rank 1 -> next is rank 2). Order = total points, then lowest shortage %
  (other-status shortage / total expected qty) at full precision, so near-equal stores are separated. Only an exact tie shares a rank.
Ranking tables (stores and circles): click a heading to sort (A to Z / Z to A, low to high / high to low, third click clears); funnel in each heading filters.
Top store of each circle: card with circle name, store, earned points, India rank and circle rank.

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
