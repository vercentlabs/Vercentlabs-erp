# Production Tracker

Replaces the old five-GO/Codex/human-UAT choreography that used to live under `00-program/`, `07-testing/` through `10-uat/`. Requirements stay in the registers/dossiers (`docs/README.md`); this file only tracks how far each module actually is.

## Verification methodology (revised 2026-09-05 after owner challenge)

"Production ready" now means a full atomic-requirement trace: every row in `SUBREQUIREMENT_REGISTER.csv` for a feature is checked against real, cited code/test evidence (file+line), not pattern-matched by test name. `FEATURE_SEMANTIC_SUBCAPABILITY_REGISTER.csv`, `FEATURE_FLOW_REGISTER.csv` and `FEATURE_STATE_TRANSITION_REGISTER.csv` were found to be ~90%+ generated boilerplate (identical text across thousands of rows, and in some cases placeholder state names that contradict the feature's own real state machine) — see commit history for the measurements. They are not traced row-by-row; the dossier + subrequirement register are the real source of truth.

Per-feature output is `docs/03-modules/<module>/features/F###-AUDIT.md` with a verdict (PASS/PARTIAL/GAP/NOT INDEPENDENTLY VERIFIED) and cited evidence per row. Gaps found during the trace are **recorded, not fixed inline** — fixing happens in one dedicated pass per module after all its features are traced, so the trace isn't constantly context-switching into implementation. Exception: a live, exploitable, cross-cutting security bug (like the approval-rejection permission bypass found this session) gets fixed immediately regardless of what pass is in progress.

## Definition of "production ready" (per feature)

A feature counts as done when, for its dossier's requirements:
- domain rules/state machine live in the module's backend service, not the UI;
- every mutation is server-authorized (tenant/company/branch/record scope) and audited;
- the full user-facing surface exists (list/detail/create/edit as applicable) with loading, empty, error, permission, and conflict states;
- concurrency/idempotency is handled where the dossier requires it;
- an automated test exercises the behavior (unit/API/security-negative as applicable);
- the dossier's `Implementation status` / `Product status` fields are updated to match reality.

"Code exists" is not the bar — reconcile against the dossier before marking anything done.

## CRM (module 1/12): atomic trace complete, gap-closing pass pending

All 30 features (F001-F030) traced against `SUBREQUIREMENT_REGISTER.csv` with cited code evidence — see `docs/03-modules/crm/features/F0##-AUDIT.md` for each. Consolidated gap list for the gap-closing pass:

**Security-relevant (prioritize first):**
- F003 Contacts: no sensitive-field redaction for contact email/phone (Leads has this via `lead-security.js`; Contacts doesn't).
- F028 Custom fields: no field-level role-visibility mechanism.

**Missing reverse/reopen paths (same bug class, found repeatedly — fix once, apply everywhere):**
- F003 Contacts: no reactivation path for an archived contact.
- F009 Opportunities: no reopen path for a closed deal (code comments imply one should exist).
- F026 Won/lost reasons: inherits F009's gap.
- F020 Territories: no cycle-detection on `parent_territory_id` (F002 Accounts solved the identical problem — copy that pattern).

**Real but scoped gaps:**
- F004 Lead sources: no original-vs-current source lineage, no campaign/referral fields.
- F005 Lead assignment: no out-of-office awareness, no fallback queue, no reassignment-SLA timer.
- F006 Lead qualification: readiness criteria hardcoded, not admin-configurable.
- F007 Lead stages: transition graph is adjacency-based not truly directional; no dwell-SLA; no reason-code vocabulary; no live-config migration tooling.
- F008 Duplicate detection: `mergeCrmLead` exists and is well-built but has zero routes/UI calling it (cheapest fix in this list — just wire it up); no dismiss action; no cross-object matching.
- F009 Opportunities: no stakeholders/products/risks/close-plan entities.
- F010 Pipeline board: stale-deal/aging data computed server-side but never rendered on cards.
- F013 Calls: a full 10-table telephony/recording/transcription schema exists with zero application code (scope decision needed: build it or drop the schema).
- F016 Follow-ups: scope-naming ambiguity with the separate nurture-queue system — needs an owner decision, not a code fix.
- F014 + F016: no confirmed reminder-notification delivery mechanism anywhere (cross-feature, worth one dedicated investigation).
- F019 Activity timeline: fixed per-source row cap (100-200), no cursor pagination — long-lived records lose old history.
- F021 Import/export: no dry-run, no upsert policy, no async/resumable path over 1,000 rows.
- F022 Conversion: converted-lead immutability not enforced (cheap fix — extend `assertLifecycleUpdate`).
- F025 Sales forecast: no accuracy/backtesting.
- F026 Won/lost reasons: no reason-label snapshot at close time (renaming a reason retroactively rewrites history).
- F028 Custom fields: no dependent-option picklists, no required-field-rollout safety check.
- F029 Bulk actions: no job cancellation, no per-row retry.
- Module-wide: AI-adjacent dossier requirements (AI-001) are consistently unbuilt — this is a real, consistent scope gap, not a bug.
- Module-wide (from F015's audit, code-comment-confirmed): 3 known-missing automation trigger call sites (`lead.updated`, `lead.qualified`, `campaign.member_responded`).

**Standing, not feature-specific:** no live E2E was run (blocked earlier on missing auth/seed fixtures — still unresolved), no human UAT, no load/perf testing exists anywhere in CRM.

**Best-in-class patterns worth reusing elsewhere in the codebase:** F027's deterministic scoring engine, F024/F030's cross-referenced dashboard/report security hardening, F021's shared formula-injection-safe CSV export, F017's fail-closed malware scanning, F012's disjoint-temporary-sequence reorder algorithm, F005/F014's correct concurrency locking.

## Module order

Following the build order already established in the existing codebase (`apps/web/src/modules/*`, `services/api/src/modules/*`):

1. CRM (30 features) — **in progress**
2. Sales (32)
3. Procurement (34)
4. Stock / Inventory (48)
5. Manufacturing (48)
6. Projects (38)
7. Assets (37)
8. Point of Sale (40)
9. Quality (35)
10. Support / Customer Service (38)
11. HR & Payroll (72)
12. Accounting / Finance (58)

A prior effort ("Pass 1") already put substantial real implementation into F015-F114, spanning CRM/Sales/Procurement/Stock — see `apps/web/tests/pass1-f015-f114.test.mjs`. That code is a starting point to audit and complete, not something to rewrite from scratch.

## Real maturity per module (corrected 2026-09-05 — includes route/API layer, not just `src/modules/*`)

| Module | web pages | api routes | dedicated tests | Verdict |
|---|---|---|---|---|
| CRM | 22 | 103 | 49 files / 454 tests | **Certified production-ready** |
| Accounting | 22 | 60 | 1 | Substantial backend, untested — audit next after Sales |
| Procurement | 25 | 10 | 0 | Real UI, thin backend test coverage |
| Sales | 11 | 14 | 0 (+ shared Pass-1 aggregate) | Strong backend (2,775-line domain layer, granular per-action permissions, audit, governance snapshots), zero dedicated tests — **in progress** |
| Stock | 5 | 10 | 3 | Thin |
| Manufacturing / Projects / Assets / POS / Quality / Support / HR-Payroll | 3 each | 3-6 each | 0-1 | Scaffolding only — effectively unbuilt |

Initial file counts under `src/modules/*` alone understated everything except CRM — the route/API layer lives separately under `src/app/(app)/<module>` and `src/app/api/<module>`.

## Status log

- 2026-09-05: Retired the process/governance doc layer (00-program, 05..11, docs/scripts) per owner direction; kept the 5 requirement registers, 510 dossiers, shared-platform requirements, cross-module contracts, and engineering standards. Fixed the two npm scripts and two test/validation files that depended on deleted docs.
- 2026-09-05: Certified CRM (30/30 features) — see git history for evidence. Owner confirmed depth-first, module-order strategy for the remaining 11 modules.
- 2026-09-05: Sales reconnaissance complete. Backend (`services/api/src/modules/sales/{index,order-governance,quotation-governance,pass1-operations}.js`, ~5,150 lines total, 33 `tenant.sales_*` tables) enforces granular per-action permissions (`sales.quotation.create/approve/send`, `sales.order.create/approve/confirm/hold/cancel/amend`, `sales.credit.override`, `sales.margin.view`), audit logging and governance snapshots on every mutation, and same-origin + billing-gated API routes. This codebase's test convention is hand-built fake-DB-client unit tests (see `services/api/tests/crm-record-scope.test.mjs`) — Sales has zero of these yet. Given `loadDocumentContext` alone issues ~10 sequential queries (company/branch/party/owner/contact/addresses/currency/exchange-rate/price-list/payment-term/settings), building accurate mocks requires reading each function closely rather than guessing; in progress, starting with the quotation lifecycle (F036-F038) before orders (F042-F044).
- 2026-09-05: While auditing Sales' approval workflow (F041) against dossier requirement SEC-001, found and fixed a real cross-module authorization bug: `apps/web/src/app/api/approvals/[id]/route.ts` and its mobile equivalent only checked `command.permission` inside the `approved` branch, so rejecting an approval (Sales quotation/order, or Accounting budget/invoice/bill/payment/journal) only required the generic `approvals.manage` permission, not the entity-specific one. The mobile route also never called `command.reject`, so a mobile rejection never reverted the underlying business record. Fixed both, added `apps/web/tests/approvals-reject-permission.test.mjs`. This affects every module with an approval workflow, not just Sales.
- 2026-09-05: Full `test:web` (541) and `test:api` (324) suites pass with zero regressions from the doc cleanup. Note: real cross-module integration coverage exists under generic file names (e.g. Wave-0/POS/Quality/Manufacturing interaction tests in `services/api/tests/`) that a module-name grep does not surface — the per-module test-count column in the maturity table above undercounts actual coverage for modules with cross-cutting logic.
