# CRM F001–F030 completion matrix

> **Status 2026-10-02 (final CRM audit):** F009 and F023 are reopened by P0 SALES-SCOPE (Sales lists and links Opportunities outside the caller's CRM scope), and mobile evidence is void because `/api/mobile/v1` was removed (MOBILE-V1). The current state is in `CRM_FINAL_ARCHITECTURE_AUDIT.md`.

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

Written after the implementation and the verification it cites (2026-09-29).
"Unit" = `services/api/tests` (mocked client), "DB" = `tests/integration/crm/*-db.test.mjs`
against real PostgreSQL on the restricted runtime role (`npm run test:crm:db`, 67 checks,
zero skipped), "E2E" = Playwright against a production build (`next start`, the CI mode).
Human UAT is pending for every feature (`CRM_UAT_F001_F030.md`).

| F-ID | Status | Evidence |
|---|---|---|
| F001 Leads | CLOSED_WITH_EVIDENCE | Unit suite; DB `lead-search-db` (trigram + definer id lookup, escaping, scope); mobile paging + server search (`crm-list-screen.tsx`); E2E `crm-mvp` Journeys A/D, `crm-regression` |
| F002 Accounts | CLOSED_WITH_EVIDENCE | Unit suite; E2E `crm-mvp` Journey B, `crm-regression`; no gap found on re-verification |
| F003 Contacts | CLOSED_WITH_EVIDENCE | Unit suite (`crm-contacts-f003`); contacts list no longer builds the address lookup for every row (p50 371 ms before); E2E `crm-mvp` Journey B |
| F004 Lead sources | CLOSED_WITH_EVIDENCE | Mobile deep link fixed to `/crm/settings/lead-sources` (`apps/mobile/tests/crm-feature-registry.test.mjs`); unit suite |
| F005 Assignment | CLOSED_WITH_EVIDENCE | Unit suite; E2E `crm-mvp` Journey A; unowned Accounts/Opportunities queue delivered by F020 coverage |
| F006 Qualification | CLOSED_WITH_EVIDENCE | Unit suite; E2E `crm-mvp` Journeys A/D |
| F007 Lifecycle | CLOSED_WITH_EVIDENCE | Unit suite; E2E `crm-mvp` Journey A |
| F008 Duplicates | CLOSED_WITH_EVIDENCE | Unit suite; E2E `crm-mvp` Journeys B/C |
| F009 Opportunities | CLOSED_WITH_EVIDENCE | Unit suite; mobile paging; E2E `crm-regression`, `opportunity-stage-transition` (stage picker now waits for its options) |
| F010 Pipeline | CLOSED_WITH_EVIDENCE | Unit suite; E2E `crm-regression` (/crm/pipeline) |
| F011 Probability | CLOSED_WITH_EVIDENCE | Weighted/expected revenue now aggregated only through the canonical, currency-converted metric layer (`pipeline-metrics-db`) |
| F012 Sales stages | CLOSED_WITH_EVIDENCE | Mobile deep link fixed to `/crm/settings/pipeline-stages`; unit suite |
| F013 Calls | CLOSED_WITH_EVIDENCE | Unit suite; no gap found |
| F014 Meetings | CLOSED_WITH_EVIDENCE (provider smoke EXTERNALLY BLOCKED) | DB `meetings-public-db` (8), `calendar-sync-db` (9); route-security validator; E2E `crm-public-booking` (3/3). Real Google/Microsoft smoke not run: no credentials |
| F015 Tasks | CLOSED_WITH_EVIDENCE | Unit suite; no gap found |
| F016 Follow-ups | CLOSED_WITH_EVIDENCE | Unit + worker suites; no gap found |
| F017 Notes/attachments | CLOSED_WITH_EVIDENCE | Mobile deep link fixed; E2E `crm-regression` (notes tab) |
| F018 Email history | CLOSED_WITH_EVIDENCE | Mobile deep link fixed to `/crm/communications`; unit suite |
| F019 Timeline | CLOSED_WITH_EVIDENCE | Mobile deep link fixed; E2E `crm-regression` (activity tab) |
| F020 Territories/teams | CLOSED_WITH_EVIDENCE | DB `coverage-db` (7); permissions migration 072/073; E2E `crm-completion` Journey D |
| F021 Import/export | CLOSED_WITH_EVIDENCE | DB `lead-import-db` (7, incl. crash/resume exactly-once and revoked authority); E2E `crm-completion` Journey E |
| F022 Conversion | CLOSED_WITH_EVIDENCE | Unit suite; E2E `crm-mvp` Journey D (retry-safe conversion) |
| F023 Quotation handoff | CLOSED_WITH_EVIDENCE | E2E `crm-completion` Journey C saves a real quotation and checks `source_opportunity_id` and the link back on the opportunity |
| F024 Pipeline dashboard | CLOSED_WITH_EVIDENCE | DB `pipeline-metrics-db` (golden dataset, FX, quota, scope); `CRM_METRIC_DEFINITIONS.md`; E2E Journey F (KPI = drill-down total) |
| F025 Sales forecast | CLOSED_WITH_EVIDENCE | DB `forecast-db` (8); E2E Journey F (submit, adjust, snapshot, lock), `crm-settings-setup` (any-dates view) |
| F026 Won/lost reasons | CLOSED_WITH_EVIDENCE | Mobile deep link fixed to `/crm/settings/lost-reasons`; unit suite |
| F027 Lead scoring | CLOSED_WITH_EVIDENCE | Unit + worker suites; no gap found |
| F028 Custom fields/tags | CLOSED_WITH_EVIDENCE | Unit suite; E2E `crm-authorization` |
| F029 Bulk actions | CLOSED_WITH_EVIDENCE | Unit + worker suites; no gap found |
| F030 CRM reports | CLOSED_WITH_EVIDENCE | DB `reports-db` (7); contract 003 retires the inert tables; E2E Journey F (save, run in worker, download) |

Defects found and fixed during verification (not only during implementation):

- The forecast snapshot route ran a different, same-named per-opportunity
  function: two `export *` sources of `@vercentlabs/api` exported
  `captureForecastSnapshot`. Renamed to `captureForecastPeriodSnapshot`;
  `services/api/tests/package-exports-unambiguous.test.mjs` now fails on any
  ambiguous package export (shown to fail with the collision restored).
- The forecast rewrite had dropped the ad-hoc "Expected to close from/until"
  view; restored on canonical figures (`DateRangeForecast.tsx`).
- The root `.gitignore` entry `coverage/` hid the Sales Coverage source
  folders from git; they would never have reached CI or a deployment.
- Owner pickers (lead assignment, coverage reassignment, record owners) were
  built from the first 50 eligible people only; anyone after the 50th name
  could not be picked. `getCrmOptions` now lists every eligible assignee (one
  query, capped at 1000 with `usersTruncated`); `owner-picker-db.test.mjs`
  fails on the old code.
- The opportunity stage picker opened empty when clicked before the CRM
  options loaded (2–4.6 s on the production build); it is disabled until
  its stages arrive.
- Table headers on five screens (import history, account detail, both
  privacy request lists) used muted text on the tinted header: 4.35:1, below
  WCAG AA 4.5:1. Surfaced by `accessibility.spec.ts` once the import journey
  left rows in the history; now the secondary text token (8.33:1).
- Two new job types lacked a job presentation; the scheduled-report
  notification category lacked a module.
- Drop of the inert report tables moved from an expand migration to tenant
  contract 003, so a rolling release never breaks the previous version.

Deliberately not done: configurable dashboards (widgets), email delivery of
scheduled reports (no platform email transport exists), real calendar
provider smoke tests (no credentials).
