# Production Tracker

Replaces the old five-GO/Codex/human-UAT choreography that used to live under `00-program/`, `07-testing/` through `10-uat/`. Requirements stay in the registers/dossiers (`docs/README.md`); this file only tracks how far each module actually is.

## Definition of "production ready" (per feature)

A feature counts as done when, for its dossier's requirements:
- domain rules/state machine live in the module's backend service, not the UI;
- every mutation is server-authorized (tenant/company/branch/record scope) and audited;
- the full user-facing surface exists (list/detail/create/edit as applicable) with loading, empty, error, permission, and conflict states;
- concurrency/idempotency is handled where the dossier requires it;
- an automated test exercises the behavior (unit/API/security-negative as applicable);
- the dossier's `Implementation status` / `Product status` fields are updated to match reality.

"Code exists" is not the bar — reconcile against the dossier before marking anything done.

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
