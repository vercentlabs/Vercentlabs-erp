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

## Status log

- 2026-09-05: Retired the process/governance doc layer (00-program, 05..11, docs/scripts) per owner direction; kept the 5 requirement registers, 510 dossiers, shared-platform requirements, cross-module contracts, and engineering standards. Fixed the two npm scripts and two test/validation files that depended on deleted docs. Starting CRM module audit.
