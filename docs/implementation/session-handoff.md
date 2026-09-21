# Session handoff

Read `README.md`, then this file. You do not need to redo the audit.

## Where things stand

- Branch `main`. Every change is a **local commit; nothing has been pushed** (the owner said not to push). `git log --oneline` from `f71c86e8` upward is this program's history.
- Working tree is clean apart from regenerated files under `docs/implementation/`. Regenerate with `node scripts/ux/build-implementation-inventory.mjs`.
- Local services: Postgres container `vercentlabs-postgres` on 5433, Next dev server on 3001. If the dev server misbehaves after large edits (edit pages answering 404, first request taking minutes), stop it and start `pnpm dev -p 3001` in `apps/web`; it recovers once compiled.
- Before running `tests/integration`, set `MIGRATION_DATABASE_URL` from `apps/web/.env.local`. Without it 80 tests skip silently and hide failures.
- Bash heredocs that contain quotes, backslashes or `$` corrupt scripts in this environment. Write scripts with the file-write tool and run them with `node`.
- Do not edit `apps/web/src` or `services/api/src` while a Playwright run is in progress: the dev server rebuilds and pages reload mid-test.

## Verified state (see `test-evidence.md` for commands and counts)

| Check | Result |
|---|---|
| API unit tests | 1,119 pass |
| Integration tests (real Postgres) | 688 pass, 0 fail, 2 skipped (need the restricted role) |
| Web unit tests | 45 pass |
| Worker tests | 102 pass |
| Package tests (10 packages) | all pass |
| Type check, lint | clean, 0 errors, 8 warnings |
| Production build | passes |
| Gates: t01, experience, architecture, db structure, no-legacy-frontend, doc links, route security, billing mutation | all pass |
| Gate: toolchain | fails only because this machine has Node 26 (repo pins 24) |
| Browser: 59 spec files run one file at a time | all pass except two that need server settings this machine lacks (see below) |
| Accessibility (axe, WCAG A/AA, critical and serious) | 55 checks pass, including Home, My work, Search, CRM settings, forecast, reports, import/export |
| Responsive (360, 768, 1024 px) | 13 pages by 3 widths, no sideways scroll |

Browser specs that fail locally for environment reasons only:
- `auth-lifecycle.spec.ts`: needs the server started with `AUTH_EMAIL_CAPTURE_ENABLED=true`.
- `billing-expired-subscription.spec.ts`: needs `BILLING_ENFORCEMENT_MODE=enforce`.

## Delivered this program (all committed locally)

Security and tenancy: verified database TLS policy, byte-bounded JSON reader, caches cleared on tenant switch and sign-out, POS offline seed recovery (unit tested; the browser offline spec still passes), locale from the saved user setting.
Defects found by running things: manufacturing shifts and inspections were calling HR and Quality functions (API root export shadowing, now guarded by a test); a new organisation could not create its first account (missing numbering series and base currency, now provisioned at registration, migrations 056 and 160); attendance list hid today's record for part of every night; job offers with an untouched salary band needed a justification; muted "planned" cards failed contrast.
CRM: lead scoring, lead lifecycle, record fields, custom fields and tags, forecast rewritten in plain language.
Platform: real Home, My work and Search (search covers CRM and Sales records plus pages).
Accounting: bank reconciliation, prepayments and revenue schedules views.
Design system: `Table` primitive (17 screens moved off raw table elements), `PageHeader` heading level.
Tooling: `scripts/qa/run-e2e-per-spec.mjs` (clears the login limiter per file), `scripts/qa/seed-e2e-fixture.mjs` (builds the browser-test organisation from an empty database through the app's own functions; used to run 20 CRM tests against a fresh organisation), `.github/workflows/erp-e2e.yml` (not yet run on GitHub), `scripts/ux/build-implementation-inventory.mjs`.

## Exact next tasks, in order

1. Run `.github/workflows/erp-e2e.yml` on GitHub (or a local Linux runner) and fix what differs: production build, `next start`, restricted database role, Ubuntu line endings. Set `AUTH_EMAIL_CAPTURE_ENABLED=true` and, for the billing spec, `BILLING_ENFORCEMENT_MODE=enforce` in a second job.
2. Make that workflow a required check once it is green.
3. Remaining PLANNED navigation entries: `/sales/availability`, `/manufacturing/resources`, `/hr/reports`, `/accounting/credit`, `/accounting/tds-tcs`, `/accounting/settings`. Sales availability is only implemented per order line today; decide the standalone page and its permission before building.
4. Review queue in `feature-status.csv`: 112 features that no source cites and 104 with backend-only evidence. For each: built but uncited, missing, or server-only.
5. POS: cold offline reload needs a service worker (SP034). The seed vault only removes the dependency on an online seed fetch after a reload while the server is reachable.
6. Cross-module journeys in `docs/04-cross-module` with two tenants; only those with existing integration tests are covered.
7. Home shows counts from CRM and approvals only; other modules do not yet contribute to Home or My work. Add them as each exposes a "mine" endpoint.
8. Lint warnings: 8 unused variables in HR and manufacturing files.
9. Other places that use the UTC date where the organisation's day is meant: `today()` in `services/api/src/modules/hr-payroll/common.js` is UTC. `listAttendance` is fixed; audit the rest.
10. Razorpay and live POS payments stay blocked on credentials (`blocker-register.md`). Rotate the SMTP app password and Razorpay secret that were pasted in chat.

## Rules that must keep holding

- Never mark anything `VERIFIED_COMPLETE` without a passing acceptance test on the recorded commit.
- Do not push. Do not weaken or delete a test to get green; fix the product, or fix a spec only when the spec is wrong and say why.
- Zero requirements are `VERIFIED_COMPLETE` today because no acceptance run is linked to a requirement id yet. Status counts in `counts.json` are evidence-of-existence, not verification.
