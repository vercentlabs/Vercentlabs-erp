# CRM F001–F030 completion matrix

This file is the working audit for the CRM completion program (canonical range
F001–F030). Part 1 is the audit taken **before** any code changed in this
pass (HEAD `0256fcd6`, 2026-09-29). Part 2 is the closing state with evidence;
it is only written after the implementation and verification it cites.

Statuses: `CLOSED_WITH_EVIDENCE`, `PARTIALLY_CLOSED`, `OPEN`,
`N/A_WITH_JUSTIFICATION`. Earlier labels in dossiers (`IMPLEMENTED`,
`PRODUCTION_READY`) and in `CRM_VNEXT_IMPLEMENTATION_REGISTER.md` were treated
as claims to re-verify, not as evidence.

## Part 1 — Pre-implementation audit (read from code, not docs)

Baseline run at `0256fcd6` with Node 24.21.0: `test:api` 1353 pass / 0 fail /
1 skipped, `test:worker` 76/76, `db:migrate` clean against the local database.

Column key: **D** data model · **L** domain logic · **A** API/contract ·
**Z** authorization · **S** tenant/company/branch/owner scope · **U** web UI ·
**M** mobile disposition · **J** background jobs · **H** audit/history ·
**I** idempotency/concurrency · **T** unit/API tests · **E** browser E2E.
`✓` present and read, `~` partial, `✗` missing.

| F-ID | D | L | A | Z | S | U | M | J | H | I | T | E | Open gap found by direct inspection | Status |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| F001 Leads | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ~ | ✓ | ✓ | ✓ | ✓ | Mobile list loads a fixed first 100 rows with no paging | PARTIALLY_CLOSED |
| F002 Accounts | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ~ | n/a | ✓ | ✓ | ✓ | ✓ | Mobile disposition only; nothing blocking found | PARTIALLY_CLOSED (re-verify) |
| F003 Contacts | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ~ | n/a | ✓ | ✓ | ✓ | ✓ | As F002 | PARTIALLY_CLOSED (re-verify) |
| F004 Lead sources | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | n/a | ✓ | ✓ | ✓ | ~ | Mobile deep link `/crm/sources` does not exist (real path `/crm/settings/lead-sources`) | PARTIALLY_CLOSED |
| F005 Assignment | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ~ | ✓ | ✓ | ✓ | ✓ | ✓ | Consumes F020 teams/territories; no reassignment queue for unowned records outside Leads | PARTIALLY_CLOSED |
| F006 Qualification | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ~ | n/a | ✓ | ✓ | ✓ | ✓ | — | PARTIALLY_CLOSED (re-verify) |
| F007 Lifecycle | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ~ | ✓ | ✓ | ✓ | ✓ | ✓ | — | PARTIALLY_CLOSED (re-verify) |
| F008 Duplicates | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ~ | ✓ | ✓ | ✓ | ✓ | ✓ | — | PARTIALLY_CLOSED (re-verify) |
| F009 Opportunities | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ~ | Mobile list paging as F001 | PARTIALLY_CLOSED |
| F010 Pipeline | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — | PARTIALLY_CLOSED (re-verify) |
| F011 Probability | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | n/a | ✓ | ✓ | ✓ | ~ | Expected revenue is summed across currencies wherever it is aggregated (dashboard, reports) | PARTIALLY_CLOSED |
| F012 Sales stages | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ | ✓ | ✓ | ✓ | ~ | Mobile deep link `/crm/stages` does not exist | PARTIALLY_CLOSED |
| F013 Calls | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | n/a | ✓ | ✓ | ✓ | ✓ | — | PARTIALLY_CLOSED (re-verify) |
| F014 Meetings | ✓ | ~ | ✓ | ~ | ~ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | (1) public availability treats **every** calendar event and booking in the organization as busy for every host; (2) `maximum_days_ahead` is stored and shown but never enforced; (3) guest name/timezone/notes are unbounded, unvalidated strings; (4) the five public meeting endpoints have **no** rate limiting; (5) real Google/Microsoft provider smoke never run | OPEN |
| F015 Tasks | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — | PARTIALLY_CLOSED (re-verify) |
| F016 Follow-ups | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — | PARTIALLY_CLOSED (re-verify) |
| F017 Notes/attachments | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ~ | n/a | ✓ | ✓ | ✓ | ~ | Mobile deep link `/crm/activities` does not exist | PARTIALLY_CLOSED |
| F018 Email history | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ | ✓ | ✓ | ✓ | ~ | Mobile deep link `/crm/inbox` does not exist (real `/crm/communications`) | PARTIALLY_CLOSED |
| F019 Timeline | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ~ | n/a | ✓ | n/a | ✓ | ✓ | Mobile deep link `/crm/activities` does not exist | PARTIALLY_CLOSED |
| F020 Territories/teams | ✓ | ~ | ~ | ~ | ✓ | ~ | ~ | ✗ | ~ | ✓ | ✓ | ✗ | Only generic CRUD under Setup (`crm.settings.manage` for everything); no coverage view by hierarchy, no unassigned-record queues for accounts/opportunities, no governed reassignment, no distinction between view coverage / manage teams / manage territories / reassign | OPEN |
| F021 Import/export | ✓ | ~ | ✓ | ✓ | ✓ | ✓ | n/a | ~ | ✓ | ~ | ✓ | ✗ | Commit processes every row synchronously inside **one** request transaction with ~3 round trips per row; preview inserts rows one at a time; no progress, no resume, no background execution, no error-row download | OPEN |
| F022 Conversion | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ~ | n/a | ✓ | ✓ | ✓ | ✓ | — | PARTIALLY_CLOSED (re-verify) |
| F023 Quotation handoff | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ~ | n/a | ✓ | ✓ | ✓ | ✗ | No browser E2E of the handoff (Journey C) | PARTIALLY_CLOSED |
| F024 Pipeline dashboard | ✗ | ~ | ~ | ✓ | ✓ | ~ | ~ | n/a | n/a | n/a | ~ | ✗ | Amounts summed across currencies; only scope+period filters (no pipeline/team/territory/owner/stage/source); drilldowns are list links whose filters are not the KPI's own population; no quota linkage; formulas duplicated between dashboard, reports and forecast; `crm_dashboards`/`crm_dashboard_widgets` inert | OPEN |
| F025 Sales forecast | ~ | ~ | ~ | ~ | ~ | ~ | ✗ | ✗ | ✗ | ~ | ~ | ✗ | `crm_forecast_snapshots` has zero writers; no scheduled capture; no team-hierarchy rollup; manager adjustment is a raw editable number with no review/history; closed/frozen periods protected only for submissions; accuracy compares only the predictive snapshot, org-wide, ignoring company scope | OPEN |
| F026 Won/lost reasons | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | n/a | ✓ | ✓ | ✓ | ~ | Mobile deep link `/crm/lost-reasons` does not exist | PARTIALLY_CLOSED |
| F027 Lead scoring | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ~ | ✓ | ✓ | ✓ | ✓ | ~ | — | PARTIALLY_CLOSED (re-verify) |
| F028 Custom fields/tags | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ~ | n/a | ✓ | ✓ | ✓ | ~ | — | PARTIALLY_CLOSED (re-verify) |
| F029 Bulk actions | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | n/a | ✓ | ✓ | ✓ | ✓ | ~ | — | PARTIALLY_CLOSED (re-verify) |
| F030 CRM reports | ~ | ~ | ~ | ✓ | ✓ | ~ | ~ | ✗ | ~ | n/a | ~ | ✗ | Static catalogue only; `crm_report_definitions`/`crm_dashboards`/`crm_dashboard_widgets` inert; shared reporting refuses schedules; no grouping/sorting/column choice for CRM analytics; pipeline/forecast formulas re-implemented separately from the dashboard | OPEN |

Cross-cutting findings:

- **Mixed currency**: every monetary aggregate (`getCrmDashboard`, `getCrmReport`
  pipeline/forecast/revenue-operations, `getForecastCalibration`) adds
  `amount` values in different `currency_code`s. `tenant.exchange_rates`
  (dated, company-or-organization) already exists and is used by Accounting.
- **Public endpoint hardening**: no raw `request.json()` in any API route;
  `readJson` is byte-bounded (100 KB); lead capture already uses a
  database-backed limiter. Public meeting routes have no limiter at all.
- **Worker**: bulk/export/scan jobs use `background_jobs` with managed
  transactions and keyset resumption; no forecast snapshot, import or scheduled
  report job exists.

## Part 2 — Closing state

Written after implementation and verification; see the bottom of this file.
