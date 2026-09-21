# Test evidence

Every row records what was actually run, where, and the result. Nothing here is inferred. "Local" means the developer machine with the local Postgres container (port 5433) and a Next dev server on port 3001. Commit is the HEAD the command ran against unless noted.

| Date | Command | Scope | Result |
|---|---|---|---|
| 2026-09-21 | `node --test` in `apps/web` | 45 web unit tests (includes body limit, DB TLS policy, locale, POS seed vault) | 45 pass, 0 fail |
| 2026-09-21 | `node --test` in `services/api` | Full API suite, 1,117 tests | Before: 1,091 pass, 26 fail. After refreshing stale SQL mocks in 6 test files: 1,117 pass, 0 fail |
| 2026-09-21 | `node --test tests/security/*.test.mjs` | Security-negative suite | 4 pass, 0 fail |
| 2026-09-21 | `node --test tests/integration/*.test.mjs` with `MIGRATION_DATABASE_URL` set to the local Postgres | Cross-module and database integration, 689 tests | First run without the variable: 80 skipped for lack of a database, which hid real failures. With the database: 666 pass, 10 fail (see below). After fixes: 687 pass, 0 fail, 2 skipped (they need the restricted runtime role) |
| 2026-09-21 | `node scripts/qa/validate-route-security.mjs` | 262 mutation-capable routes | Passed, 0 unexplained gaps |
| 2026-09-21 | `npx tsc --noEmit` in `apps/web` | Type check | Clean |
| 2026-09-21 | `npx eslint .` in `apps/web` | Lint | 0 errors, 8 warnings (unused variables in HR/manufacturing files) |
| 2026-09-21 | `NEXT_DIST_DIR=.next-build npx next build` in `apps/web` | Production build | Exit 0, compiled in 3.4 min |
| 2026-09-21 | `playwright test` CRM set (crm-regression, opportunity-stage-transition, crm-authorization, crm-uiux, crm-public-booking, crm-settings-setup) | 25 browser tests, local dev server | First run: 19 pass, 6 fail (dev server dropped connections mid-run, and the public-booking specs had run out of free slots). After fixing the spec to book a random day and re-running: all listed specs pass |
| 2026-09-21 | `playwright test accounting-schedule-views.spec.ts` | Reconciliation, prepayments, revenue schedules load | 3 pass |

## Not run in this session

- Full `playwright test` (all 58+ specs). CRM subset only.
- Mobile, worker, SDK and package suites.
- Accessibility (axe) sweep, responsive screenshots at 360/768/1024/1440.
- POS offline reload in a real browser (unit tested only).
- Cross-browser runs. Chromium only.

## Failures found and their cause

- 26 API tests: mocks matched an old shape of the Stock `items` query and lacked the newer freeze-check, valuation-layer and location-fallback queries. Product code was correct; tests were stale. Fixed in the test files only.
- Public-booking e2e: earlier runs booked the host's earliest slots, so a fixed "tomorrow" had none left. Not a product defect. The spec now picks a random day.

## Real defects the database run exposed

- Manufacturing shifts and inspections: the API root exported HR's `listShifts` and Quality's `listInspections` in place of Manufacturing's functions of the same name, so the Manufacturing pages called the wrong module and demanded HR/Quality permissions. Renamed to `listManufacturingShifts` and `listManufacturingInspections`; guard test `services/api/tests/api-index-no-shadowed-exports.test.mjs` fails if any root export hides another.
- Test isolation: SP008 inserted a module row that new organizations now get automatically; the HR workforce audit-trail count was not scoped to its own organization. Both tests fixed. Product code unchanged.
- The plans/billing failure in the full run did not reproduce in isolation (18 pass) or in the second full run; cause not identified, likely interference from the failing SP008 test. Watch it.

## Full browser run, one spec file at a time (2026-09-21 to 22)

Command: `node scripts/qa/run-e2e-per-spec.mjs` (clears the login rate limiter before each file). Local Postgres, Next dev server, Chromium.

- A back-to-back `playwright test` of all 136 tests gave 78 pass / 56 fail, but most failures were the login rate limiter (10 logins per 5 minutes per IP) and 18 specs sending API calls to port 3000 (where the marketing site answered with its 404 page) instead of 3001. Neither says anything about the product. Both fixed in the test tooling (`e2e/base-url.ts`, the per-spec runner).
- First per-spec pass: 42 of 59 files passed, 17 failed. After the fixes below and re-runs, the files that still fail locally are only the two that need server settings this machine does not have:
  - `auth-lifecycle.spec.ts`: needs `AUTH_EMAIL_CAPTURE_ENABLED` on the server; the dev server here sends through the real SMTP settings, so the capture endpoint answers 404.
  - `billing-expired-subscription.spec.ts`: needs `BILLING_ENFORCEMENT_MODE=enforce`; this machine runs `observe`, so the write is not blocked (409 instead of 402).
- Several specs pass or fail depending on dev-server compile latency (3 second waits after a route's first hit). Those were re-run and passed: pos-checkout, inventory-outbound, procurement-planning-analytics, procurement-sourcing-orders, mfa-sp007, sales-quotations, sales-customers.

### Real product defects the browser run found and fixed
- A new organisation had no numbering series and no base currency row, so its first "New account" failed (`CRM_ACCOUNT_NUMBERING_UNAVAILABLE`, then a foreign-key error). `registerOrganization` now provisions both; migrations 056 (platform) and 160 (tenant) add the functions and repair existing organisations. Integration test added to `organization-registration.test.mjs`.
- Attendance: the "my attendance" list defaulted its end date to the UTC day, so between midnight and 05:30 IST the record just made was hidden. It now uses the organisation's calendar day.
- Offers: an opening whose salary band was left untouched is stored as 0 to 0, which made every offer need a justification. A bound of zero now means "not set".
- Contrast: planned and locked cards on the settings page and in the sidebar used `opacity-60` on already muted text (contrast 2.3, WCAG needs 4.5). Fixed; `settings-accessibility` and `accessibility` (35 checks) pass.

### Spec fragility fixed (product unchanged)
Runs of earlier days filled shared lists and unique-per-date tables, so several specs now use their own day, code or search: assets depreciation cut-off, ECN title, public booking day, catalogue search. HR payroll tolerates rounding of the proration to the cent; HR time-and-leave uses the organisation's day; labels of required fields end in "*" so exact-name matches use a pattern; status badges are sentence case so POS transaction checks ignore case.

### Not fixed
- `Home` still shows a "being connected" placeholder card (see session-handoff.md).
- No CI run of `.github/workflows/erp-e2e.yml` has happened; the steps were checked locally (migrate, seed a fresh organisation, run CRM specs against it: 20 tests pass) but not on GitHub.
