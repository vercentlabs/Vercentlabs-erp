# Session handoff

Read `README.md`, then this file. You do not need to redo the audit.

## Where things stand

- Branch `main`. All work is in **local commits, nothing pushed** (the owner said not to push). `git log --oneline` shows the sequence from `f71c86e8` upward.
- Working tree is clean apart from generated files under `docs/implementation/`. Regenerate them with `node scripts/ux/build-implementation-inventory.mjs`.
- Local services: Postgres container on 5433, Next dev server on 3001 (Playwright reuses it). Set `MIGRATION_DATABASE_URL` from `apps/web/.env.local` before running `tests/integration`, otherwise 80 tests skip silently.

## Done since the "full completion" order

| Area | Result |
|---|---|
| Security | TLS verification policy and byte-bounded JSON reader, extracted and unit tested |
| Tenancy | Client caches cleared on tenant switch and sign-out |
| Locale | `<html lang>` and formatting follow the user's saved locale |
| POS offline | Seed recovered after a cold reload through a non-extractable device key; wiped on sign-out and switch (unit tested only) |
| CRM | Lead scoring, lead lifecycle, record fields, custom fields & tags, forecast rewritten in plain language with states, confirmations and e2e |
| Accounting | Reconciliation, prepayments, revenue schedules are real views |
| Design system | `PageHeader` has `headingLevel` so a page keeps one h1 |
| Defect found by DB run | Manufacturing shifts/inspections called HR/Quality functions; fixed and guarded |
| Tests | API 1,117/1,117, integration 687 pass / 0 fail / 2 skipped, web unit 45/45, production build OK, CRM e2e set passing |
| Evidence | `counts.json`, `routes.csv`, `feature-status.csv`, `requirement-matrix.csv`, `test-evidence.md` |

## In flight when this was written

A full `playwright test` run was started in the background writing `/tmp/e2e-full.log` (ends with a line `exit N`). If that file exists, read it for failures before doing anything else. If it does not, rerun: `cd apps/web && npx playwright test --reporter=line`. Expect the run to take over an hour.

## Exact next tasks, in order

1. Triage the full e2e run. Fix product defects; fix stale specs only when the spec, not the product, is wrong. Record results in `test-evidence.md`.
2. CI cannot run browser tests: `apps/web/e2e/fixtures.ts` reads a hand-made `.env.e2e.local` (owner, restricted user, lead/opportunity/account/contact ids). Write an idempotent seeder script that creates an organization, users and CRM rows through the app's own APIs and writes that file, then add `.github/workflows/erp-e2e.yml` with a Postgres service, `pnpm db:setup`, the seeder, and the critical specs (`crm-*`, `billing-plans`, `platform-security`, `accessibility`). Make it a required check.
3. Accessibility sweep: run `e2e/accessibility.spec.ts` style axe checks over every CRM settings page and the module homes; fix findings. Multiple `h1` per page was found on the CRM settings pages built with `EnterpriseListPage`; only Custom Fields & Tags was fixed. Search for other pages that stack several `EnterpriseListPage` headers.
4. Responsive sweep at 360, 768, 1024, 1440 for the CRM pages changed here.
5. Remaining PLANNED navigation entries: `/sales/availability`, `/manufacturing/resources`, `/hr/reports`, `/accounting/credit`, `/accounting/tds-tcs` (the tax returns view supports TDS but nothing for TCS), and admin-only `/accounting/settings`. Decide per item whether a real backend exists before building a page.
6. Review queue in `feature-status.csv`: 112 features no source cites, 104 with backend-only evidence. Decide built-uncited, missing, or server-only for each.
7. Browser test for POS offline: go offline, reload, record a sale, reconnect, confirm it syncs once.
8. Cross-module journeys (`docs/04-cross-module`) with two tenants: only the ones with existing integration tests are covered.
9. Warnings: 8 unused-variable lint warnings in HR and manufacturing files.

## Blockers

See `blocker-register.md`. Razorpay keys are still missing, which blocks live billing verification only.

## Rules that must keep holding

- Never mark anything `VERIFIED_COMPLETE` without a passing acceptance test on the recorded commit.
- Do not push, and do not weaken or delete a test to get green.
- Bash heredocs containing quotes, backslashes or `$` break in this environment. Write scripts with the Write tool and run them with `node`.
