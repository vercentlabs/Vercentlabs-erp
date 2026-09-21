# Projects: implementation tracker (F193-F230)

Status legend: **Verified** = exercised by a real-PostgreSQL integration test written this pass and/or a browser
spec; **Partial** = works with a stated limit; **Not built** = absent. This is a status record, not a completion claim.

## What existed and what this pass added

Before this pass Projects was a thin domain (`index.js`, untouched) and a placeholder page. This pass added, in
`services/api/src/modules/projects/`:

| File | Scope |
|------|-------|
| `common.js` | errors, validators, integer-minor-unit money, working-day maths, project scope (a team member sees only their projects), money/rate masking |
| `setup.js` | settings, templates (cycle-checked), project record and status machine (plan, approve, activate, hold, resume, complete, cancel, reopen), close blockers, team with over-allocation guard, availability net of approved HR leave |
| `planning.js` | WBS and sub-tasks, task state machine, dependencies (FS/SS/FF/SF, lag, cycle refusal), milestones, critical-path scheduler, conflicts, Gantt/Kanban/calendar data, progress roll-up, status reports, baselines and variance, template instantiation |
| `time.js` | time entries with captured rates, timesheets (submit, recall, approve, reject, reopen), expenses with FX and reimbursement, materials issued/returned through real Stock movements, procurement links (commitment vs actual) |
| `finance.js` | actuals, budgets and revisions, cost variance and breakdown, profitability (revenue by method, EV/CPI/EAC/VAC), snapshots, fixed-price / milestone / time-and-material billing handed to Accounting as a draft invoice |
| `control.js` | issues, risks (realise into an issue), documents (confidential), comments with mentions |
| `reports.js` | dashboard and ten reports |
| `desk.js` | public names (96), collision-checked against the root export |

Migration `159` (schema expansion) and platform migration `053` (see Findings). Web: 18 register pages plus
dashboard, workspace, reports and settings; about 40 read views and 65 actions over two dispatcher routes, wrappers
registered in the route-security matrix.

## Verification

* `tests/integration/projects-{setup,planning,time-cost,finance,control-reports}.test.mjs`: 41 subtests against real
  PostgreSQL, including Stock issue/return, Accounting draft-invoice handoff, HR-leave availability, CPM
  scheduling, baselines and confidential documents.
* `apps/web/e2e/projects-delivery.spec.ts`: two real `project_manager` users. One creates and plans a project and is
  refused when approving it; the other approves; the first starts it, adds a task, logs time and submits the week;
  the second approves the timesheet; the workspace WBS and portfolio report render; a user with no project
  permissions is refused. Passed (after one run that timed out on cold dev-server compilation).
* Gates: `tsc --noEmit`, `eslint`, route-security matrix and validator (254 routes, 0 gaps), billing mutation gate.

## Findings fixed on the way

* No seeded role held `projects.approve`, so a Project Manager could create and plan but nobody could approve.
  Platform migration `053` grants it to `project_manager`; segregation of duties still stops the creator approving
  their own work.

## Status by area

| Area | Status |
|------|--------|
| F193-F196 projects, types, templates, approval, status machine, close checks | Verified (domain + browser) |
| F197-F203 WBS, tasks, dependencies, milestones, scheduling, Gantt, Kanban, calendar | Verified (domain); WBS view verified in browser. Gantt and board are **read-only** views; tasks move through the Tasks page |
| F204-F206 allocation, capacity, availability | Verified (domain). Capacity is a table, not a heat map |
| F207-F210 time, timesheets, expenses, materials | Verified (domain); time and timesheet approval verified in browser |
| F211-F215 budgets, procurement links, cost variance, breakdown | Verified (domain); budget approval UI built, not browser-tested |
| F216-F218 billing to Accounting | Verified (domain: draft invoice created once). Browser flow not exercised |
| F219-F224 issues, risks, documents, comments | Verified (domain). Comments and @mentions have API and domain but **no screen**; documents are references, not file storage |
| F225-F230 profitability, dashboard, reports, settings | Verified (domain); dashboard/reports render checked in browser |

## Known gaps (not built or partial)

* Baseline approve/reject exist as actions but the workspace only offers capture and listing; no approve button.
* No comments/mentions screen; mentions are not delivered as notifications.
* No file upload or storage for project documents.
* No drag-and-drop on Gantt or Kanban.
* No CSV import of tasks or time.
* Billing, materials and budget screens were not driven in a browser; only their domain paths are tested.
