# Shadowfax Airtel Store Audit Tracker

A stock audit web app for Airtel stores run by Shadowfax. Store teams count serialized stock (barcode scan) and non-serialized stock against an uploaded base file; the app reconciles expected vs physical, scores every store and ranks stores and circles.

**Live site:** https://meetfluorine.github.io/airtel-audit
**Repo:** https://github.com/MeetFluorine/airtel-audit

Everything runs as a static site — HTML, CSS and vanilla JavaScript, no build step. Data lives in Supabase (Postgres with Row Level Security, Auth and Storage); every permission check runs inside SECURITY DEFINER Postgres functions, never in the browser.

## Contents

- [Roles](#roles)
- [How to use](#how-to-use)
- [How an audit flows](#how-an-audit-flows)
- [Scoring & ranking](#scoring--ranking)
- [Reports](#reports)
- [Deadlines & escalation](#deadlines--escalation)
- [Setup](#setup)
- [Project structure](#project-structure)
- [Tech](#tech)

## Roles

| Role | Sees | Can do |
| ---- | ---- | ------ |
| Store User | Own store only | Upload base data (first upload), scan / count stock, preview, submit & lock audit |
| Circle Head | Own circles | Dashboards, results, rankings, reports for their circles; revise base data until audit starts |
| Admin | Everything | Approve users, manage stores / circles / cycles / base data, close cycles, all reports, audit logs |

## How to use

**Store User**
1. Register, choose your store, and wait for Admin approval.
2. When an audit cycle starts, upload your base data (first upload only — it freezes after that).
3. Scan serialized items and enter counts for non-serialized items. The checklist shows what is left.
4. Check the Preview screen, then Submit. The audit locks — it can't be edited after.
5. You have **3 days** per cycle; the dashboard banner counts down and turns red when overdue.

**Circle Head**
1. Open the Dashboard for store-wise Expected / Found / Short / Excess.
2. Check Rankings (stores, circles, pan-India) and open any store's Audit Result.
3. Generate Reports for your circles (scope-safe: you only ever see your own circles).

**Admin**
1. Approve users on the Users page (store and management sign-ups).
2. Create audit cycles (deadline is auto-stamped 3 days out) and manage stores, circles and base data.
3. Close a cycle any time — audits stop, data stays, and it can't be reopened from the app.
4. Export any report and read the audit logs.

## How an audit flows

| Step | What happens | Rule |
| ---- | ------------ | ---- |
| 1. Register & login | User signs up as store or management level | Nothing works until an Admin approves the request |
| 2. Base data | Store uploads its base stock file | First upload only, then frozen. Admin / Circle Head can revise later; a re-upload replaces the whole base and finished audits are re-compared against it |
| 3. Audit starts | Cycle opens, scanning begins | A checklist shows what is left to audit |
| 4. Serialized entry | Barcode scanning | Each scanned serial is matched against a base line |
| 5. Non-serialized entry | Quantity counts per item | Counted against expected quantities |
| 6. Preview | Full reconciliation preview | Match rate, variance lines, everything reviewable before locking |
| 7. Submit | Audit is submitted | Locked and versioned — old versions stay viewable, nothing can be edited |
| 8. Result | Match rate donut, KPIs, variance table | Expected / Found / Short (split: In transit · Other) / Excess; remarks can be added per short line |
| 9. Ranking | Stores and circles ranked | Points and dense ranks computed per cycle (see below) |

## Scoring & ranking

| Rule | Detail |
| ---- | ------ |
| Points per cycle | 20 participation + match rate % — max 120. A missed cycle scores 0 |
| Ranking style | Dense ranking: 1, 2, 3 — two stores sharing rank 1, the next is rank 2 |
| Tie-break | Lowest shortage % (other-status shortage ÷ total expected qty), at full precision |
| Circle rank | Average points per store in the circle |
| In-transit | A short line whose status contains "transit" stays in the audit data but is shown separately and kept out of ranking points |
| Visibility | Store users see their circle + India rank; Circle Heads see their stores; Admin sees all |

## Reports

| Report | Needs | Contents |
| ------ | ----- | -------- |
| Store Audit Report | a store | Full reconciliation: every line (matched / short / excess), Serialized vs Non-Serialized, In-Transit flag |
| Circle Shortage Report | a circle | Shortage lines only, store-wise |
| Pan-India Audit Overview | — | One row per store: expected / physical / short splits / excess / match rate / status |
| Store Audit Status | — | Completed / In Progress / Not Started per store, with Deadline and Days Left |
| User Report (Active / Inactive) | — | Every user: contact, role, store / circles, approval status |

Reports open from the **Generate Report** button: pick a type from the grouped dropdown, set Circle / Store, then preview or download as `.xlsx`. Circle Heads only ever get their own circles.

## Deadlines & escalation

Every audit cycle gets a **3-day deadline**, stamped automatically at creation. Nothing auto-locks at the deadline — it is enforced by visibility, so no audit is ever lost.

| Surface | Behaviour |
| ------- | --------- |
| Store dashboard banner | "X days left" (info) → "Due today / tomorrow" (warning) → "Overdue by X days" (red). Hidden once submitted |
| Sidebar cycle widget | "Due \<date\> — N days left" or overdue state; progress line shows overdue count |
| Staff dashboard | Red "Overdue" badge on pending stores + an "Overdue" tab with count |
| Store Status report | "Deadline" and "Days Left" columns (negative = days overdue) |

## Setup

| Step | Action |
| ---- | ------ |
| 1 | In the Supabase SQL editor, run `database/*.sql` in numeric order, once each — every file is safe to re-run |
| 2 | Skip `02_seed_and_tests.sql` on a real project — it's demo data. Run `21` before `22` |
| 3 | The public anon key is already in `js/supabase.js`. Never put the `service_role` key in this repo |
| 4 | Host the folder on any static host (GitHub Pages, Netlify…). No server code to deploy |

Key migrations:

| File | Purpose |
| ---- | ------- |
| `01_schema.sql` | Base tables |
| `02_seed_and_tests.sql` | Demo data (skip on real projects) |
| `04`–`10_phase*.sql` | Phase builds — schema + `SECURITY DEFINER` RPCs (`report_rows`, `_dash_rows`, …) |
| `12_audit_checklist.sql` | "What is left to audit" checklist |
| `14_delete_account.sql` | Permanent account deletion |
| `15_management_signup.sql` | Store / management level sign-up with Admin approval |
| `17_close_cycle_store_base.sql` | Admin close-cycle + store user base data page |
| `18_ranking.sql` | Ranking engine (re-run after edits to `_rank_points()`) |
| `20_short_split_revise_base.sql` | In-transit short split + replace-anytime base stock |
| `21_new_reports.sql` | 5 new report types in `report_rows` |
| `22_audit_deadlines.sql` | 3-day deadlines + escalation columns |

## Project structure

| Path | Contents |
| ---- | -------- |
| `index.html` | App shell — all pages render here |
| `js/app.js` | Routing, menus, sign-up / approval flow |
| `js/audit.js` | Store audit: scanning, preview, result page |
| `js/dashboard.js` | Admin / Circle Head dashboards, store detail |
| `js/ranking.js` | Rankings, top-store cards |
| `js/reports.js` | Generate Report modal, previews, `.xlsx` export |
| `js/cycle.js` | Audit cycles, deadlines, sidebar widget |
| `js/supabase.js` | Supabase client (public anon key) |
| `css/` | One stylesheet per feature (`result-table.css`, `ranking.css`, …) |
| `database/` | Numbered SQL migrations, run once each in order |
| `assets/` | Static images (`banner.jpg`, …) |

## Tech

- **Frontend:** static HTML + CSS + vanilla JavaScript. No framework, no build step.
- **Backend:** Supabase — Postgres with Row Level Security on everything, Auth, and Storage (base-stock Excel backups).
- **Data access:** all through `SECURITY DEFINER` Postgres functions; the browser never decides permissions.
- **Hosting:** any static host. The live site runs on GitHub Pages from `main`.
