# Shadowfax Airtel Store Audit Tracker

A stock audit web app for Airtel stores run by Shadowfax. Store teams count serialized stock (barcode scan) and non-serialized stock against an uploaded base file; the app reconciles expected vs physical, scores every store and ranks stores and circles.

**Live site:** https://meetfluorine.github.io/airtel-audit

Everything runs as a static site — HTML, CSS and vanilla JavaScript, no build step. Data lives in Supabase (Postgres with Row Level Security, Auth and Storage); every permission check runs inside SECURITY DEFINER Postgres functions, never in the browser.

## How to use

**Store User**
1. Register, choose your store, and wait for Admin approval.
2. When an audit cycle starts, upload your base data (first upload only — it freezes after that).
3. Scan serialized items and enter counts for non-serialized items.
4. Check the Preview screen, then Submit. The audit locks — it can't be edited after.
5. You have **3 days** per cycle; the dashboard banner counts down and turns red when overdue.

**Circle Head**
1. Open the Dashboard for store-wise Expected / Found / Short / Excess.
2. Check Rankings (stores, circles, pan-India) and open any store's Audit Result.
3. Generate Reports for your circles (scope-safe: you only ever see your own circles).

**Admin**
1. Approve users on the Users page (store and management sign-ups).
2. Create audit cycles (deadline is auto-stamped 3 days out) and manage stores, circles and base data.
3. Close a cycle any time — audits stop, data stays. Export any report, read the audit logs.

## What it does

| Step | Rule |
| ---- | ---- |
| 1. Register | Store users pick a store; management users pick circles. Nothing works until an Admin approves. |
| 2. Base data | First upload per store per cycle, then frozen. Admin / Circle Head can revise later; a re-upload replaces the whole base and re-compares finished audits. |
| 3. Audit | Serialized lines are barcode-scanned; non-serialized lines get quantity counts. A checklist shows what is left to audit. |
| 4. Deadline | Every cycle gets a 3-day deadline. Store banners, the sidebar widget and an Overdue tab escalate it — nothing auto-locks, so no audit is ever lost. |
| 5. Submit | Preview first, then Submit locks the audit (versioned; old versions stay viewable). |
| 6. Result | Match rate donut, Expected / Found / Short (split: In transit · Other) / Excess, variance table with remarks per short line. |
| 7. Ranking | 20 participation points + match rate (max 120 per cycle). Dense ranking 1, 2, 3 — ties share a rank, tie-break is lowest shortage %. |

## Reports

| Report | Needs | Contents |
| ------ | ----- | -------- |
| Store Audit Report | a store | Full reconciliation: every line (matched / short / excess), Serialized vs Non-Serialized, In-Transit flag |
| Circle Shortage Report | a circle | Shortage lines only, store-wise |
| Pan-India Audit Overview | — | One row per store: expected / physical / short splits / excess / match rate / status |
| Store Audit Status | — | Completed / In Progress / Not Started per store, with Deadline and Days Left |
| User Report (Active / Inactive) | — | Every user: contact, role, store / circles, approval status |

Reports open from the **Generate Report** button: pick a type from the grouped dropdown, set Circle / Store, then preview or download as `.xlsx`.

## Setup

1. In the Supabase SQL editor, run `database/*.sql` in numeric order, once each (every file is safe to re-run). Skip `02_seed_and_tests.sql` on a real project — it's demo data. Run `21` before `22`.
2. The public anon key is already in `js/supabase.js`. Never put the `service_role` key in this repo.
3. Host the folder on any static host (GitHub Pages, Netlify…). No server code to deploy.

## Tech

- Frontend: static HTML + CSS + vanilla JavaScript, no framework, no build step (`index.html`, `css/`, `js/`).
- Backend: Supabase — Postgres with Row Level Security on everything, Auth, and Storage (base-stock Excel backups). All data access goes through `SECURITY DEFINER` Postgres functions (`report_rows`, `_dash_rows`, ranking, …).
- Migrations: `database/01_*.sql` → `database/22_*.sql`, numbered, run once each in order.
