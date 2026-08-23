# ERP Verification Baseline (Prompt 2 of 102)

Date: 2026-08-08
Scope: restore a trustworthy, deterministic verification safety net for `apps/web`, `apps/mobile`, `services/api`, `packages/*`, and the platform-level database schema — no product/feature changes. Builds directly on `docs/implementation/ERP_WEB_AUDIT_001.md` (Prompt 1); read that document first.

Starting git state: branch `main`, working tree clean except one untracked file (`docs/implementation/ERP_WEB_AUDIT_001.md` from Prompt 1). No destructive git operations were used at any point in this prompt.

---

## 1. Previous State

Prompt 1 found that `apps/web` and `apps/mobile` had **zero executable automated tests**, that roughly 80 of the root `package.json`'s ~140 scripts pointed at files that no longer existed, and attributed this to a single commit, `90ee1c8`.

Independently re-investigating this in Phase A/B of this prompt (per the instruction not to blindly trust the prior report) found the picture was **substantially larger** than Prompt 1 captured: the deletion was not one commit but **three consecutive commits on 2026-08-05, 33 minutes apart, all by the same author**, and Prompt 1's audit only inspected the last of the three. Combined, they removed **271 files and 39,090 lines** — roughly 2.9x what was previously documented (96 files / 13,334 lines):

| Commit | Time | Message | Files deleted | Lines deleted |
|---|---|---|---|---|
| `cbac98d` | 14:59:30 | "chore: remove legacy documentation and scripts" | 129 | 20,904 |
| `ed91276` | 15:05:08 | "chore: remove legacy validation tests and workflow" | 46 | 4,852 |
| `90ee1c8` | 15:32:18 | "chore: remove legacy app checks and restore dependency patch" | 96 | 13,334 |
| **Total** | | | **271** | **39,090** |

None of the three commits touched a single `package.json`, `turbo.json`, or any Dockerfile. This is the root cause of the dangling-script problem: the code that scripts pointed to was removed, but the pointers were not.

61 commits have landed on `main` since `90ee1c8` (all landing-site design work); **none of them restored, replaced, or even touched** `apps/web/tests/`, `apps/web/scripts/`, `services/api/tests/`, `services/api/test/`, `apps/mobile/tests/`, or the root `scripts/`/`tests/` directories. This confirms Prompt 1's finding that the gap was never noticed or addressed — consistent with the fact that `.github/workflows/` (after `cbac98d`/`ed91276` also removed `release-readiness.yml`) never exercised `apps/web`, `apps/mobile`, or `services/api`; it only runs `apps/landing`'s pipeline.

## 2. Commit Analysis

**Was this intentional or accidental?** The evidence points to a **deliberate, but incomplete, cleanup** — not an accident:
- All three commit messages explicitly say "remove legacy" (documentation, validation tests and workflow, app checks), not "delete," "revert," or an unexplained bulk removal.
- The deleted documentation set (`docs/implementation/stages/STAGE_1..STAGE_11*.md`, `docs/implementation/stages/CRM_01..CRM_12*.md`, `docs/implementation/FOUR_MODULE_MASTER_PLAN.md`, `docs/implementation/FOUR_MODULE_COMPLETION_POLICY.md`, `docs/implementation/tests/four-module-feature-register.json` (5,868 lines), `four-module-feature-evidence.json` (6,357 lines)) and the deleted scripts (`scripts/validation/verify-stage-*.mjs`, `verify-crm-01..12-*.mjs`, `verify-419-feature-completion.mjs`, `report-four-module-progress.mjs`) are **the same incremental-delivery framework, deleted together** — its own process documentation and its own verification tooling, removed in the same 33-minute window. This reads as a coordinated decision to retire an entire prior delivery methodology (a "419/four-module benchmark, staged-gate" process), not a slip of `rm -rf`.
- This 102-prompt program is a plausible, coherent replacement for exactly that retired methodology.

**What was genuinely obsolete vs. still valid**, checked against **current** code (not assumed):
- The **hyper-granular stage/CRM-stage/four-module verification scripts** (`verify:stage-1`…`verify:stage-11`, `verify:crm-01`…`verify:crm-12` and their `*-complete`/`*-live` variants, `verify:419-complete`, `report:419`, `verify:four-module-plan`, `verify:enterprise`, `verify:implementation`, `verify:product-release`, `report:release-readiness`, `release:benchmark-gate`) are tied to that retired framework and its now-deleted supporting docs (`FOUR_MODULE_COMPLETION_POLICY.md`, the stage docs). Rebuilding them would mean reviving a process this program appears to supersede — genuinely obsolete for this baseline. **Not restored.**
- The **unit/contract test files** (`services/api/tests/financial-decimal.test.mjs`, `accounting-service.test.mjs`, `business-data-service.test.mjs`, `billing-service.test.mjs`; `apps/web/tests/enterprise-rbac.test.mjs`, `stage-one-platform.test.mjs`, `foundation.test.mjs`; `tests/security/security-boundaries.test.mjs`; `tests/integration/platform-contracts.test.mjs`) test **architecture, not process** — RBAC, RLS, financial decimal math, business-data scoping, billing economics. Every function, file, and SQL token they reference was individually re-verified to still exist in current code before restoring anything (see Section 3). These are the ones this prompt restored.
- **One assertion was found to be stale and was corrected, not blindly restored**: the deleted `tests/integration/platform-contracts.test.mjs` asserted `ERP_MODULE_CATALOG.filter(m => m.availability === "released").map(m => m.key)` equals `["accounting", "procurement", "sales", "crm"]` — the old 4-module release scope. Current `packages/shared-types/src/modules.js` marks **all 12 modules** `availability: "released"` (confirmed in Prompt 1's audit, re-confirmed here by direct read). Restoring the old assertion verbatim would have immediately and correctly failed against current code — it would have been testing a fact that is no longer true. The restored version now asserts the current (all-12-released) state and is annotated explaining the change; this is the concrete example of Phase B's "adapt to current codebase, don't blindly restore."
- **One deleted test could not be safely restored even in part**: `tests/security/security-boundaries.test.mjs`'s second test case shelled out to `export-project-code.sh`, which was itself deleted in `cbac98d`. That sub-test was dropped; the first (CSV/log/attachment data-boundary test, which depends only on still-current `packages/document-engine`, `packages/observability`, `packages/reporting-engine`) was restored.
- `apps/web/tests/stage-one-platform.test.mjs` had three assertions; the third read `.github/workflows/release-readiness.yml` and `apps/landing/scripts/verify-platform-live.mjs` (a genuine Postgres+Playwright live-verification script) — both gone, and reviving that specific CI gate is out of scope for a routine offline check. That assertion was dropped; the other two (login anti-lockout policy, Sales pages rendering `AccessDenied` instead of a blank screen) depend only on still-current files and were restored under a new, less process-coupled filename: `apps/web/tests/auth-session-safety.test.mjs`.
- `services/api/tests/crm-service.test.mjs` (474 lines, 17 test cases) was reviewed but not restored wholesale — several of its later cases assert on JSONB opportunity-field governance and forecast-status transitions that would need re-verification against current schema line-by-line, which is more than "restore a test" for this prompt's scope. Instead, a smaller, new `services/api/tests/crm-core.test.mjs` was written covering the same category (deterministic lead scoring, governed-resource validation) using only functions directly confirmed present in current `services/api/src/modules/crm/index.js`.

## 3. Restored Verification Assets

All restored test files were checked, before being written, against the **current** repository — every imported function, file path, table name, and SQL token cited below was independently grep/read-verified to exist right now, not assumed from the deleted file's own claims.

| File | Origin | Verification performed before restoring |
|---|---|---|
| `services/api/tests/financial-decimal.test.mjs` | Restored verbatim from `ed91276^` | Confirmed `allocate/asDatabaseDecimal/decimal/div/format/mul/roundMoney` all still exported by `services/api/src/core/decimal.js` |
| `services/api/tests/accounting-service.test.mjs` | Restored verbatim from `ed91276^` | Confirmed `services/api/src/modules/accounting/money.js`, `schedules.js`, `payables.js` still export the exact functions imported; confirmed `ACCOUNTING_REPORT_KEYS` and `ACCOUNTING_PERMISSIONS` keys still match |
| `services/api/tests/business-data-service.test.mjs` | Restored verbatim from `ed91276^` | Confirmed all 5 imports (`BusinessDataError`, `createBusinessDataRecord`, `getBusinessDataOverview`, `isBusinessDataResource`, `listBusinessDataRecords`) present in `services/api/src/index.js` |
| `services/api/tests/billing-service.test.mjs` | Restored verbatim from `ed91276^` | Confirmed all 6 imports present in `services/api/src/core/billing.js` |
| `services/api/tests/crm-core.test.mjs` | **New** (not a restoration) | Written against confirmed-current `isCrmResource`/`calculateLeadScore` in `services/api/src/modules/crm/index.js`; deliberately narrower than the deleted 474-line file (see Section 2) |
| `apps/web/tests/enterprise-rbac.test.mjs` | Restored verbatim from `90ee1c8^` | Confirmed `ROLE_TEMPLATES` in `apps/web/src/core/access-control.ts` still has exactly 29 templates with the same slugs/assignability (including `inventory_manager`/`manufacturing_manager`/`hr_manager` still `assignable: false` — see Known Gap in Section 8); confirmed all 12 referenced source files exist |
| `apps/web/tests/auth-session-safety.test.mjs` | Adapted from `90ee1c8^`'s `stage-one-platform.test.mjs` (2 of 3 tests kept, renamed) | Confirmed `login-policy.ts`/login routes/`access-denied.tsx`/Sales pages still contain the exact tokens asserted |
| `apps/web/tests/foundation.test.mjs` | Restored verbatim from `90ee1c8^` | Confirmed verify-email/reset-password routes and the `002_platform_foundation.sql` `CREATE TABLE IF NOT EXISTS` statements still match |
| `tests/security/security-boundaries.test.mjs` | Adapted from `ed91276^` (1 of 2 tests kept) | Confirmed `document-engine`/`observability`/`reporting-engine` exports unchanged |
| `tests/security/tenant-isolation-rls.test.mjs` | **New** (not a restoration — no equivalent existed before) | Statically verifies the RLS convention documented in Prompt 1's audit; see Section 9 for what it does not (and cannot, without a live database) prove |
| `tests/integration/platform-contracts.test.mjs` | Adapted from `ed91276^` (assertion corrected, see Section 2) | Confirmed `ERP_MODULE_CATALOG`, `createCommandRegistry`, `rowsToCsv` all still exported as used |
| `apps/web/scripts/verify-routes.mjs` | **New** (Phase F — no prior equivalent existed) | Static route smoke validation; see Section 6 |
| `scripts/validation/verify-db-structure.mjs` | **New** (Phase D Level 4 — no safe offline equivalent existed before; the deleted `verify-*-database.mjs` scripts required a live Postgres connection) | Static migration-structure validation; see Section 6 |

**Test count**: 15 test files, 45 individual `test(...)` cases, all passing (Section 11).

## 4. Scripts Fixed

| Script | Previous State | Change | Current State |
|---|---|---|---|
| `apps/mobile` → `test` | `node --test tests/*.test.mjs` — **errors** (not just no-ops) because `tests/*.test.mjs` matches nothing | Changed to bare `node --test`, matching the convention already used by `apps/web` and `services/api`, which gracefully reports "0 tests" instead of failing when no test files are present | Valid; root `test:mobile` now runs without erroring |
| root → `test:web` | Delegated to `apps/web`'s `test`, which found 0 files | No command change — fixed by restoring 3 files at their original `apps/web/tests/*.test.mjs` paths | Valid; runs 15 real tests |
| root → `test:api` | Delegated to `services/api`'s `test`, which found 0 files | No command change — fixed by restoring 5 files at their original `services/api/tests/*.test.mjs` paths | Valid; runs 25 real tests |
| root → `test:integration` | `node --test tests/integration/*.test.mjs` — directory didn't exist | No command change — fixed by restoring `tests/integration/platform-contracts.test.mjs` (with a corrected assertion, see Section 2) | Valid; runs 1 real test |
| root → `test:security` | `node --test tests/security/*.test.mjs` — directory didn't exist | No command change — fixed by restoring 2 files at `tests/security/*.test.mjs` | Valid; runs 4 real tests |
| root → `test:enterprise-rbac` | `pnpm --filter web exec node --test tests/enterprise-rbac.test.mjs` — target missing | No command change — fixed by restoring the target file | Valid; runs 10 real tests |
| root → `format:check` | Referenced `tests/e2e/README.md`, `tests/integration/README.md`, `docs/implementation/stages/STAGE_1_PLATFORM_CORRECTNESS.md`, `.github/workflows/release-readiness.yml` (all deleted, none restored — reviving that specific CI gate is out of this prompt's scope) and `apps/landing/scripts/verify-platform-live.mjs` (also deleted, not restored — a live-verification script, out of scope) | Rewrote the file list to the still-current subset (`login-policy.ts`, `access-denied.tsx`, Sales pages, login routes, the three restored/adapted `apps/web/tests/*.test.mjs` files, root `package.json`); dropped the `apps/landing` half entirely rather than pointing it at an unrelated existing file, since the original intent (checking the deleted live-verification script's formatting) no longer applies | Valid, confirmed passing (Section 11) |
| root → `db:verify:stock`, `db:verify:manufacturing` | Both were literal duplicates of `db:verify:control`/`verify:database` (same underlying command, different names) | Removed as part of the broader `verify:*`-family cleanup (Section 5); superseded by `verify:db` | N/A — see Section 5 |

## 5. Scripts Removed

Every removal below is preserved in git history (the exact prior command is recoverable from any commit before this one) and was investigated, not deleted reflexively.

**Removed as part of the retired stage/CRM-stage/four-module delivery framework** (documentation and own verification tooling both deliberately removed together on 2026-08-05 — see Section 2's reasoning): `verify:stage-1`, `verify:stage-2a`, `verify:stage-4` through `verify:stage-11`, `verify:crm-01` through `verify:crm-12` (and every `-complete`/`-live` variant), `verify:crm-complete`, `verify:crm-product` (+ variants), `test:crm-product` (+ variants), `verify:enterprise-rbac` (the root-level script; **not** `test:enterprise-rbac`, which was fixed, see Section 4), `test:enterprise-rbac-live`, `verify:enterprise-rbac-complete`, `verify:enterprise`, `verify:implementation`, `verify:product-release`, `verify:four-module-plan`, `report:419`, `verify:419-complete`, `report:release-readiness`, `release:benchmark-gate`, `release:production:gate`, `verify:release` (superseded by the new `verify`/`release:verify`, see Section 6), `test:platform-live`, `format:stage-1`, `release:gate:live` (chained `test:platform-live`), `test:crm-foundation-live` and every other `*:live` alias listed in Prompt 1's audit (25 total in `apps/web/package.json`), `verify:stock`, `verify:manufacturing`, `verify:projects`, `verify:assets`, `verify:point-of-sale`, `verify:quality`, `verify:support`, `verify:hr-payroll` (per-module scripts calling both a deleted root validator and a deleted `apps/web/tests/*-module.test.mjs` file — rebuilding per-module acceptance suites is feature-shaped work for a dedicated future prompt, not this baseline prompt).

**Removed as dangerous operational tooling this prompt deliberately did not rebuild** (schema migration, billing reconciliation, background-job processing, deployment): `db:migrate:control`, `db:migrate:tenant`, `db:cleanup:auth`, `db:provision:runtime-role`, `crm:jobs`, `crm:outbox`, `crm:provider-jobs`, `crm:privacy-retention`, `billing:sync-plans`, `billing:reconcile`, `billing:retry-webhooks`, `db:backup`, `db:restore`, `smoke:deployment`, `validate:production-env:web`/`landing`/`migration`. **Why not just leave them broken instead of removing:** these are not "verification" scripts (Prompt 2's scope) — they mutate schema, money, or external systems. Restoring their *implementation* safely requires live-infrastructure decisions (which Postgres, which Razorpay environment) and product judgment about current schema compatibility that belongs to a dedicated future prompt, explicitly out of scope per this prompt's Phase J. Leaving ~15 scripts that *look* runnable but would `MODULE_NOT_FOUND` on `apps/web/scripts/<name>.mjs` is worse than removing them with a clear, findable git history — anyone who needs one back can retrieve the pre-deletion implementation from commit `90ee1c8^` and re-review it against current schema before wiring it back in.

**Removed as pure duplicates**: `verify:database` / `db:verify:control` (both delegated to the same broken script), `db:verify:stock` / `db:verify:manufacturing` (both were literal aliases of the same `verify:database` chain), `test:contracts` / `test:e2e` (byte-identical `node --test tests/e2e/*.test.mjs` command — the `tests/e2e/` directory holding 7 real user-flow test files was deleted and not restored in this prompt, see Section 8).

**Removed as unrelated to verification**: `phone:android` (a PowerShell helper to deploy the Expo app to a physical Android phone over USB; its target `scripts/mobile/android-phone.ps1` was deleted in `cbac98d` and is a developer convenience workflow, not a verification check — flagged here rather than silently dropped, recoverable from git history if wanted back).

## 6. Verification Architecture

Six tiers, all built from commands that exist and were run successfully during this prompt (Section 11):

- **Level 1 — Fast** (`pnpm verify:fast`): `typecheck:web && lint:web && test:web && test:api`. What a developer should run on every save/commit-adjacent iteration. No database, no build, no live services.
- **Level 2 — Web** (`pnpm verify:web`): `verify:fast && verify:routes && build:web`. Adds the new static route-structure check (Phase F, `apps/web/scripts/verify-routes.mjs`) and a full Next.js production build — the strongest static contract check available without a database.
- **Level 3 — Mobile** (`pnpm verify:mobile`): `typecheck:mobile && lint:mobile`. Deliberately does **not** require an Android/iOS emulator, per Phase D's explicit instruction; `apps/mobile`'s own behavioral test suite remains a documented gap (Section 8) since its test files were deleted and not restored in this prompt.
- **Level 4 — Database** (`pnpm verify:db`): `node scripts/validation/verify-db-structure.mjs` (new). Reads every `.sql` file under `database/platform/migrations` and `database/tenant/migrations` and checks, without connecting to any database: every migration is transaction-wrapped (`BEGIN;`…`COMMIT;`), every tenant migration that creates a table also `ENABLE`s and `FORCE`s row-level security, every tenant table has an `organization_id` column, no migration contains `DROP DATABASE`/unguarded `DROP SCHEMA`/`TRUNCATE`, and no two migration files in the same directory share a numeric prefix (currently: 1 warning — see Section 12).
- **Level 5 — Full** (`pnpm verify`): `verify:fast && verify:routes && verify:mobile && verify:db && test:sdk && test:packages && test:integration && test:security && test:enterprise-rbac`. The composite "safe to keep working" gate every future prompt should run before ending its turn.
- **Level 6 — Release** (`pnpm release:verify` / `pnpm release:gate`): `verify && build:web && lint:landing && typecheck:landing && build:landing && test:landing && test:landing:e2e` (plus `format:check` and `audit:dependencies` under `release:gate`). This is stricter but still fully composed of commands verified to run in this prompt. It intentionally does **not** include deployment smoke tests, database backup/restore rehearsal, or billing reconciliation — those require live infrastructure this prompt does not have access to and are documented as environment-dependent gaps (Section 9), not silently dropped.

`turbo.json` was **not modified**. Its `test` task declares `outputs: ["coverage/**"]`, but no test runner in this repository (`node --test`, run without `--experimental-test-coverage`) ever produces a `coverage/` directory — this output declaration is dead and was already dead before this prompt (see Prompt 1's audit). Per Phase H's "prefer minimal corrections," it was left alone rather than edited without a concrete behavioral bug to fix: turbo silently caches nothing for that output, which is misleading but not broken. This is called out here as a documented, low-priority (P3) observation rather than silently ignored.

## 7. Tests Restored

**Auth/session** (`apps/web/tests/auth-session-safety.test.mjs`, `apps/web/tests/foundation.test.mjs`): login anti-lockout rate-limiting policy is shared identically between browser and mobile login routes; Sales pages render `<AccessDenied>` instead of returning `null` for unauthorized users; email verification/resend flow wiring; password reset revokes sessions and never re-sets the session cookie.

**RBAC** (`apps/web/tests/enterprise-rbac.test.mjs`): 29-role catalogue completeness and slug uniqueness; every role's permissions exist in the canonical permission catalogue with no duplicates; least-privilege for `employee`/`auditor` roles (explicit allow case: base employee permissions; explicit deny case: auditor is asserted to lack `roles.manage`, `accounting.journal.post`, etc.); maker-checker separation for accounting/sales/procurement duties; blocking separation-of-duties conflict detection; permission grant-ceiling enforcement (a delegator cannot grant permissions they don't hold); module-availability-gated role assignability; the `018_enterprise_roles_permissions.sql` migration's schema contract; cumulative-role and effective-dated assignment wiring in both web and mobile UI.

**Tenant isolation / RLS** (`tests/security/tenant-isolation-rls.test.mjs` — new): every tenant-schema migration that creates a table also `ENABLE`s and `FORCE`s row-level security (checked across all 52 files); the foundational `tenant_organization_isolation` policy exists with the correct `USING`/`WITH CHECK` clauses; `packages/database`'s `setTenantContext` binds the organization id as a parameter (`$1`), never string-interpolates it. **What remains integration-only**: whether RLS actually blocks a cross-tenant read/write at runtime — see Section 9.

**Accounting invariants** (`services/api/tests/financial-decimal.test.mjs`, `accounting-service.test.mjs`): BigInt fixed-point decimal math is symmetric for positive/negative multiplication and division; the 7th decimal digit rounds away from zero; money formatting/allocation preserves totals exactly; currency-precision rounding; payment-term installment allocation sums to the exact document total; the accounting permission/report-key contract; **a payables-import path rejects Procurement matches without Accounting permission, and rejects Procurement matches still in an unresolved exception state** — this is the closest existing test to "rejection of invalid/unbalanced transactions" reachable without a live database (the actual double-entry `totalDebit !== totalCredit` guard in `services/api/src/modules/accounting/journals.js:182`, identified in Prompt 1's audit, requires a real database round-trip to exercise and remains integration-only, see Section 9).

**CRM core** (`services/api/tests/crm-core.test.mjs` — new, `apps/web/tests/enterprise-rbac.test.mjs` partially): unknown-resource rejection; governed-resource allowlist validation; deterministic lead-scoring rule evaluation (both a scoring case and a zero-score case, mocked at the `client.query` boundary — no live database required, matching the original deleted test's own mocking pattern).

**Business-data governance** (`services/api/tests/business-data-service.test.mjs`): unknown-resource rejection; allowlisted item-insert SQL shape; a base-currency comparison regression guard (prevents a specific historical `$2 = $6` parameter-binding bug from recurring); branch access fails closed with zero permitted branches (an explicit deny case) and rejects writes to unauthorized branches/companies; administrators retain all-company/all-branch access (an explicit allow case); organization-wide resources remain available without an active branch; overview aggregate queries are scoped by company/branch/allow-all correctly.

**Billing** (`services/api/tests/billing-service.test.mjs`): Launch-plan gross margin stays above the 70% floor; Razorpay plan payloads do not incorrectly multiply amount by seat count; subscription payloads use quantity 1 with an optional onboarding add-on; write-access gating respects grace periods; provider webhook event ordering is deterministic (older events are rejected); subscription status mapping.

**Web route validation** (`apps/web/scripts/verify-routes.mjs` — new, invoked as `test`-adjacent Phase F, not a `node --test` file): all 116 `page.tsx` files have a resolvable default export; all 279 `route.ts` files export at least one recognized HTTP method handler; no sibling directories define conflicting dynamic route segments.

**Mobile validation**: static only (`typecheck:mobile`, `lint:mobile`) — no behavioral test restoration in this prompt; see Section 8.

**Database validation** (`scripts/validation/verify-db-structure.mjs` — new): see Section 6.

## 8. Known Test Gaps

Stated explicitly, not silently left implicit:

- **`apps/mobile` has no behavioral tests restored.** The three deleted files (`architecture.test.mjs`, `offline-crm.test.mjs`, `web-parity.test.mjs`) were reviewed but not restored — Phase D scoped mobile verification to static checks (typecheck/lint) explicitly, and restoring mobile-specific offline-sync/parity tests was judged out of this prompt's primary categories (Section E's 7 named categories are all web/API-side). `apps/mobile`'s own `test` script now runs safely (reports "0 tests" rather than erroring) but exercises nothing.
- **`tests/e2e/` (7 real user-flow test files: `approval-user-flow`, `crm-discoverability`, `crm-report-export`, `crm-structured-fields`, `deep-user-flow-guard`, `public-smoke`, `user-flow-guard`) was not restored.** These require a running application instance (they are true end-to-end flows, not unit tests), which is a materially larger undertaking than the static/unit-level restorations in this prompt. `test:e2e`/`test:contracts` were removed rather than left silently broken (Section 5); a dedicated future prompt should decide whether and how to rebuild live E2E coverage.
- **`apps/landing/scripts/verify-platform-live.mjs` and `verify-browser-journeys.mjs`/`verify-production-journeys.mjs` were deleted in `90ee1c8` and were not restored** — contrary to an early assumption made mid-investigation in this same prompt (a research pass initially reported landing's `scripts/`/`tests/` directories as fully intact; this was independently checked by actually running `format:check` against `verify-platform-live.mjs` and finding it missing — the assumption was wrong and was corrected before shipping, see Section 4's `format:check` fix). Landing's own `test`, `test:e2e`, `test:browser`, `test:a11y`, `lighthouse:baseline` scripts remain valid and unaffected — only the three *live-verification-against-a-deployed-environment* scripts are gone.
- **The double-entry `totalDebit !== totalCredit` rejection itself is not directly unit-tested.** `services/api/tests/accounting-service.test.mjs` tests the decimal math and installment allocation that feed into it, and a related payables-governance guard, but the actual balance-check `throw` in `services/api/src/modules/accounting/journals.js:182` requires inserting journal lines through a real transaction and was judged to need a live database to exercise meaningfully rather than a superficial mock — see Section 9.
- **RBAC role catalogue vs. module-availability catalogue inconsistency, confirmed still present.** `apps/web/tests/enterprise-rbac.test.mjs` asserts `inventory_manager`/`manufacturing_manager`/`hr_manager` roles remain `assignable: false` — and this is still true in current code. But `packages/shared-types/src/modules.js` marks Stock, Manufacturing, and HR & Payroll `availability: "released"` (Prompt 1, Section 1). These two sources of truth (module availability vs. role assignability) are inconsistent with each other **today**, independent of anything this prompt did. This prompt's restored test intentionally asserts the current (unreconciled) state and is annotated explaining why — it exists specifically so that whoever reconciles this inconsistency does so as a deliberate decision (updating the test alongside the fix), not as an unnoticed side effect. Not fixed in this prompt (Phase J: no product scope changes).
- **`services/api` and `apps/web` test coverage is now non-zero but still narrow relative to the codebase.** 40 new/restored assertions across ~26,000 lines of `services/api` business logic (Prompt 1's estimate) is a safety net for the highest-value invariants named in Phase E, not comprehensive coverage. Sales order-lifecycle logic, CRM's ~12,500 lines of subsystem files beyond `calculateLeadScore`/`isCrmResource`, and all 8 "roadmap" modules' service files (Stock, Manufacturing, Projects, Assets, POS, Quality, Support, HR & Payroll) remain untested by this baseline.

## 9. Environment-Dependent Checks

Checks that exist conceptually (in the deleted files, in Phase E's categories, or as natural extensions of what was restored) but require infrastructure not available in this session, listed explicitly rather than faked:

- **Live PostgreSQL** — required for: actually exercising Row-Level Security cross-tenant denial (querying as organization A and confirming organization B's rows are invisible even to a superuser-adjacent role — Section 7's structural RLS test proves the policy *exists* on every table, not that it *works* end-to-end); exercising the real `totalDebit !== totalCredit` journal-balance rejection through an actual insert; running `db:migrate:control`/`db:migrate:tenant` to confirm the 78 migration files apply cleanly in order; running any of the removed `db:verify:*-database.mjs`-style live schema checks. `pnpm infra:up` starts a local Postgres via `infrastructure/docker/compose.local.yml`, but running migrations and RLS-bypass attempts against it was judged out of scope for a routine, repeatable verification pass in this prompt (and using it would itself be a state-mutating action against a database, which Phase D explicitly says not to do without being asked).
- **A running `apps/web` instance** — required for the 7 deleted `tests/e2e/*.test.mjs` user-flow tests (approval flow, CRM discoverability, report export, structured fields, deep user-flow guard, public smoke, general user-flow guard) and for `apps/landing`'s `verify-platform-live.mjs`/`verify-browser-journeys.mjs`/`verify-production-journeys.mjs` (none of which were restored, Section 8).
- **Razorpay sandbox credentials** — required to actually exercise `billing:sync-plans`, `billing:reconcile`, `billing:retry-webhooks` end-to-end (the unit-level economics/payload-shape logic they depend on is now tested in `billing-service.test.mjs`, but the network calls themselves are not).
- **Android/iOS emulator or device** — required for `apps/mobile`'s `android`/`ios`/`export` scripts and any restored behavioral mobile test; deliberately excluded from `verify:mobile` per Phase D.
- **`APP_URL`, `DATABASE_URL`, and other production environment variables** — `build:web` was run and **passed without requiring any of these** (see Section 11) because Next.js 16's App Router build does not eagerly evaluate server-side environment reads for these dynamically-rendered routes; this was confirmed empirically, not assumed.

## 10. Commands for Future Prompts

```text
FAST DEVELOPMENT CHECK (every iteration)
pnpm verify:fast

WEB CHECK (before ending a web-touching prompt)
pnpm verify:web

MOBILE CHECK (static only — no emulator required)
pnpm verify:mobile

DATABASE CHECK (safe — reads migration files, contacts no live database)
pnpm verify:db

FULL PRE-COMMIT CHECK (the default "did I break anything" gate)
pnpm verify

RELEASE CHECK (stricter — includes landing build/e2e, formatting, dependency audit)
pnpm release:verify
pnpm release:gate   # release:verify + format:check + audit:dependencies

INDIVIDUAL TIERS, if isolating a failure
pnpm typecheck:web
pnpm lint:web
pnpm test:web
pnpm test:api
pnpm test:sdk
pnpm test:packages
pnpm test:integration
pnpm test:security
pnpm test:enterprise-rbac
pnpm verify:routes
```

## 11. Verification Results

All commands below were actually executed in this session; none of the results are assumed.

| Command | Result |
|---|---|
| `git status` (before any change) | Clean except one untracked file from Prompt 1 (`docs/implementation/ERP_WEB_AUDIT_001.md`) |
| `git log --oneline` around the deletion, `git show --stat` on all three commits | 271 files / 39,090 lines deleted across `cbac98d`, `ed91276`, `90ee1c8`; 0 `package.json`/`turbo.json` files touched; 61 commits since, none touching the deleted paths |
| `node --test` in `services/api` | **25/25 pass** (financial-decimal, accounting-service, business-data-service, billing-service, crm-core) |
| `node --test` in `apps/web` | **15/15 pass** (enterprise-rbac, auth-session-safety, foundation) |
| `node --test tests/security/*.test.mjs tests/integration/*.test.mjs` (root) | **5/5 pass** (security-boundaries, tenant-isolation-rls, platform-contracts) |
| `pnpm verify:fast` | **PASS** — typecheck:web clean, lint:web clean (pre-existing 1 warning only, see Prompt 1), test:web 15/15, test:api 25/25 |
| `pnpm verify:mobile` | **PASS** — `tsc --noEmit` clean, `eslint .` clean |
| `pnpm verify:db` | **PASS** — 0 failing checks, 1 warning (duplicate migration prefix `039`, see Section 12) |
| `pnpm verify:routes` (via `apps/web`) | **PASS** — 116 page.tsx + 279 route.ts checked, 0 failures |
| `pnpm test:sdk` | **PASS** — 12/12 |
| `pnpm test:packages` | **PASS** — all 9 filtered packages (config, document-engine, landing-content, localization, observability, reporting-engine, shared-ui, test-utils, workflows) |
| `pnpm format:check` (rewritten, Section 4) | **PASS** — all matched files use Prettier code style |
| `pnpm build:web` | **PASS** (see below) |

**`pnpm build:web` detail**: ran to completion successfully with **no environment variables set** beyond what the shell already had — no `DATABASE_URL`, no `APP_URL`, no Razorpay keys. This means the failure/blocked distinction Phase I asks for did not arise: the build is genuinely code-clean, not merely untested due to missing environment. Combined with Prompt 1's clean `typecheck`/`lint` results, the `apps/web` codebase's static-analysis health is strong across every dimension checked so far.

**Overall**: every restored/new test passes, every fixed script runs, every new script runs and reports 0 failing checks (1 non-fatal warning from `verify:db`, Section 12). No test was written to pass trivially — each restored test was checked against current code and 4 required a correction (Section 2) rather than a verbatim restoration before they would have passed.

## 12. Remaining Risks

**P0 — blocks product/security/data integrity**
- None newly introduced by this prompt. Prompt 1's P0s (broken worker container, three confirmed security gaps) are unchanged — they are product/code fixes, explicitly out of scope for this infrastructure-only prompt (Phase J).

**P1 — major functional issue**
- `tests/e2e/` (7 real user-flow tests) and `apps/mobile`'s 3 behavioral tests remain unrestored (Section 8) — the highest-value near-term restoration work for a focused follow-up prompt, since the mocking/assertion patterns are already known from git history and were reviewed (not blindly trusted) in this prompt.
- The RBAC-vs-module-availability inconsistency (Section 8) is a real, evidence-backed product inconsistency that a future prompt should either fix (make the 3 future roles assignable, since their modules are now released) or explicitly ratify as intentional — currently neither has happened, and it predates this prompt.
- Live-database checks (RLS cross-tenant denial, journal-balance rejection, migration apply) remain entirely unexercised in this or any prior session per the evidence available — the structural/static equivalents in this baseline are real but are a lower bar than runtime proof (Section 9).

**P2 — architecture/maintainability**
- `database/tenant/migrations/` has two files sharing numeric prefix `039` (`039_crm_ai_feedback_draft_id.sql`, `039_crm_offline_completion.sql`) — confirmed by the new `verify:db` script. Both apply correctly today because they're ordered lexicographically by full filename, not by numeric prefix alone, but this is fragile: a migration runner keyed on numeric prefix rather than full filename would silently skip one of them. Recommend renumbering one of the two files (or the entire post-039 sequence) in a dedicated, careful migration-renumbering prompt — not done here since it touches the same files a live-database migration run would need to be re-validated against, which this prompt intentionally did not perform.
- `turbo.json`'s `test` task declares a dead `outputs: ["coverage/**"]` (Section 6) — cosmetic, left unchanged per "minimal corrections."

**P3 — cosmetic/non-critical**
- `phone:android` (Android USB-deploy helper) was removed rather than restored — recoverable from git history if a mobile developer wants it back; low-risk, low-value to rebuild speculatively.
- This baseline's new tests (45 assertions) are real but narrow relative to the ~26,000 lines of untested `services/api` business logic Prompt 1 identified — expected and documented (Section 8), not a defect of this prompt, but worth tracking as the module-completion work in later prompts increases the untested surface further if test-writing doesn't keep pace.
