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

## CRM (module 1/12): production-ready — gap-closing pass complete (2026-09-06)

All 30 features fully traced; every real, reasonably-scoped gap the trace found is fixed (17 fixes, each with its own migration where needed, real regression tests, and clean `tsc`/`eslint`/`verify:db`/`verify:architecture`). The items left in "Real but scoped gaps" below are deliberately **not** fixed — they are multi-day feature additions (new entities, a notification-delivery subsystem, an import-engine redesign, forecast-backtesting analytics), not gaps in what CRM already claims to do; closing them is new scope, decided against for now in favor of moving to the next module. Standing E2E/UAT/load-testing gaps remain, as noted below — these need a human, not more code.

All 30 features (F001-F030) traced against `SUBREQUIREMENT_REGISTER.csv` with cited code evidence — see `docs/03-modules/crm/features/F0##-AUDIT.md` for each. Consolidated gap list for the gap-closing pass:

**Fixed (2026-09-05):**
- F003 Contacts: sensitive-field redaction for email/phone/mobile added (`contact-security.js`, mirrors Leads).
- F022 Conversion: converted-lead immutability now enforced in `assertLifecycleUpdate`.
- F020 Territories: cycle detection added on `parent_territory_id` (copied F002 Accounts' recursive-CTE pattern).
- F028 Custom fields: field-level role visibility added (`visible_to_roles`), enforced on both read (redaction) and write (block).
- F013 Calls: unused 10-table telephony/recording/transcription schema dropped per owner decision; Calls stays manual-logging only.
- F016 Follow-ups: "My Follow-ups" rewired to the lead nurture queue per owner decision — the "gap" was a naming/wiring problem, not missing engineering (30/37 rows now PASS, biggest single jump in the pass).
- F010 Pipeline board: stale-deal/aging data (already computed by `evaluateOpportunityHealth`) is now rendered on each card as overdue/stale badges; stage's `stale_after_days` threshold is now selected and compared.
- F003 Contacts: added `reactivateCrmContact` (mirrors `archiveCrmContact`), wired to `PATCH .../contacts/[id]` with `{action:"reactivate"}` and a "Reactivate" button on the detail page; blocks reactivation while the linked account is still archived.
- F009 Opportunities + F026 Won/lost reasons: `moveOpportunityStage` now allows a won/lost opportunity to reopen into a non-terminal stage of the same pipeline (required reason, `archived` opportunities stay permanently blocked). Migration `078_f009_opportunity_reopen_history.sql` adds `status`/`outcome_reason_id`/`outcome_reason_label`/`outcome_notes` to `crm_opportunity_stage_history`, so every close and reopen is permanently snapshotted with the reason's label at that moment — this single change closed F009's reopen gap and F026's reason-label-snapshot gap together, since they were the same missing capability. Governed "Reopen" UI added to the Opportunity detail page; stage-history timeline now shows the snapshotted outcome per transition.
- Module-wide: the 3 known-missing automation trigger call sites (`lead.updated`, `lead.qualified`, `campaign.member_responded`) now fire from `updateCrmRecord`, `decideLeadQualification` and `captureCrmLead` respectively — all 7 `crm_automation_rules.event_type` values have a real call site.
- F019 Activity timeline: added `getLeadTimelinePage` + `GET /api/crm/leads/[id]/timeline` so activities/communications can page past their initial 200-row cap; correction along the way — the audit's originally-cited `getLeadTimeline` function turned out to be dead code, the real path is `getLeadDetailData`.
- F029 Bulk actions: added job cancellation (migration `079` adds `'cancelled'` to `background_jobs.status`, exactly the additive migration 052's own comment anticipated) and per-row retry (`retryFailedLeadBulkJobItems` re-queues only the previously-failed rows of a finished job, not the whole selection).
- F008 Duplicate detection: added a "dismiss" outcome distinct from override — `dismissLeadDuplicateMatch` marks a *probable* candidate as reviewed-and-not-a-duplicate (never an exact match, which still requires the separate per-write override), reusing the existing immutable `crm_lead_duplicate_overrides` ledger with a new `operation='dismiss'` value.
- F028 Custom fields: added dependent-option picklists (`depends_on_field_key`, migration `081`; `options` becomes a `{parentValue:[childValues]}` map for a dependent field) and a required-field-rollout safety check (`assertCustomFieldRequiredRolloutSafe` blocks marking a field required while active records lack a value for it, unless explicitly confirmed).
- F004 Lead sources: added original-vs-current source lineage (`crm_leads.original_source_id`, migration `082`, fixed at creation and permanently immutable afterward) and a `referrer_name` field for referral/campaign attribution details (`campaign_id` already existed).
- F006 Lead qualification: readiness criteria moved from a hardcoded JS array to `tenant.crm_lead_qualification_criteria` (migration `083`, seeded per-organization at creation and backfilled for existing orgs) — genuinely admin-editable at CRM Setup → Lead management → "Qualification criteria". While wiring this, found and fixed a related bug: F028's `custom-field-definitions`/`custom-records` admin UI existed but was unreachable by any live route (not in `scope.ts`'s resource-key lists) — now exposed under Setup → Customization.
- F005 Lead assignment: added out-of-office awareness (`crm_lead_assignee_availability`, migration `084`, excluded from round-robin/workload/territory/fixed automatic assignment, never blocks manual assignment), a fallback owner (`crm_lead_assignment_fallback`, checked once, last, after every policy fails), and a scheduled Lead-SLA-breach/reassignment tick (`crm.automation.detect_lead_sla_breaches`) — the reassignment domain logic (`scanLeadSlaBreaches`) already existed and was correct, it just had no scheduled trigger, only a manual "Scan now" action.

**Correction, not a fix needed:** F008 Duplicate detection's "merge is unreachable" finding was wrong (twice) — the merge workflow (backend + route + UI + confirmation) is fully built and working. Root cause: bash `**` globs silently fail to recurse into `[id]` route directories in this environment without `shopt -s globstar`; several existence checks this session used that pattern. Re-verified with the Grep tool: F009/F013/F003-reactivation/F016-reminders/F029-cancellation all hold up; F008 was the only false negative found. F008's remaining gaps (dismiss now fixed, see Fixed list above): matching rules hardcoded, no cross-object (Lead vs Contact/Account) matching, no field-conflict reconciliation on merge.

**Real but scoped gaps:**
- F007 Lead stages: transition graph is adjacency-based not truly directional; no dwell-SLA; no reason-code vocabulary; no live-config migration tooling.
- F008 Duplicate detection: matching rules hardcoded, no cross-object matching, no field-conflict reconciliation on merge (see correction above).
- F009 Opportunities: no stakeholders/products/risks/close-plan entities.
- F014 + F016: no confirmed reminder-notification delivery mechanism anywhere (cross-feature, worth one dedicated investigation) — re-verified with Grep tool, holds up.
- F021 Import/export: no dry-run, no upsert policy, no async/resumable path over 1,000 rows.
- F025 Sales forecast: no accuracy/backtesting.
- Module-wide: AI-adjacent dossier requirements (AI-001) are consistently unbuilt — this is a real, consistent scope gap, not a bug.

**Standing, not feature-specific:** no live E2E was run (blocked earlier on missing auth/seed fixtures — still unresolved), no human UAT (cannot be performed by the AI — needs the owner), no load/perf testing exists anywhere in CRM.

**Best-in-class patterns worth reusing elsewhere in the codebase:** F027's deterministic scoring engine, F024/F030's cross-referenced dashboard/report security hardening, F021's shared formula-injection-safe CSV export, F017's fail-closed malware scanning, F012's disjoint-temporary-sequence reorder algorithm, F005/F014's correct concurrency locking.

## Sales (module 2/12): trace in progress (started 2026-09-06)

F031 Customer master traced first (Sales doesn't own a customer entity — it consumes CRM's `tenant.business_parties` read-only, so this feature is really about that consumption boundary and the read paths built around it). See `docs/03-modules/sales/audits/F031-AUDIT.md`.

**Fixed immediately (live, cross-cutting security bugs, per the methodology's own exception):**
- Cross-company data leak: `getSalesOptions` and all 9 `getSalesReport` variants filtered only by `organization_id`, with zero `company_id` scoping, despite `business_parties`/`items`/`warehouses`/`crm_opportunities`/`sales_quotations`/`sales_orders` all carrying a `company_id` column and RLS in this system being organization-only everywhere (no company/branch-level RLS exists at all — that scoping is an application-layer responsibility per query, confirmed by reading the RLS-application migration block). A user restricted to one company could see every other company's customers, items, warehouses, opportunities, quotations, orders and margin data. Fixed by mirroring the already-correct `getSalesDashboard` convention (and CRM's own `companyVisible()` pattern) across both functions, fail-closed when there's no active company. Regression-tested in `services/api/tests/sales-options-company-scope-f031.test.mjs`.
- Cost-permission bypass: `getSalesOptions`'s `items` query returned `standard_cost` unconditionally to any `sales.view` caller, bypassing the `sales.margin.view` gate the rest of the module enforces consistently (`redactMargin` on quotation/order reads, an explicit permission check on the `margin` report). Fixed by routing `getSalesOptions`'s return through the existing `redactMargin` helper instead of a new mechanism. The web app doesn't currently read this field, so there was no UI to update.

**Real but scoped gaps found, recorded for the Sales gap-closing pass:**
- Pagination: `getSalesOptions`'s customer/contact/address/item picker queries have no `LIMIT` at all (unlike its own `opportunities` query, capped at 200), and `listQuotations` has a `LIMIT 200` with no offset/cursor/count — two different failure modes (unbounded fetch vs. silent truncation) from the same root cause: no pagination convention adopted yet in this module.
- F033 Products: no item-variant support on sales lines (`item_variants` exists, owned by Stock/F100, but `sales_quotation_lines`/`sales_order_lines` only reference `item_id`); no write-in/non-catalog line policy (undocumented either way).
- F034 Price lists: no explicit invalidate action for a price-list item or pricing rule (only date-range expiry); `pass1-operations.js`'s `companySql` helper uses a different (stricter, safe) company-scoping convention than `getSalesDashboard`/`getSalesOptions`'s `companyVisible`-style helper — worth reconciling for consistency.
- F035 Customer-specific prices: no customer-*group* pricing tier (individual customer only); no approval or reason capture for a standing negotiated price, a real asymmetry against the much-lower-stakes single-line manual override, which does require both.
- **F038 Quotation expiry (priority item, real functional/commercial-integrity gap, not just missing polish):** nothing anywhere ever transitions a quotation's `lifecycle_status` to `expired` when `valid_until` passes — no scheduled job exists (the "wiring gap" pattern found repeatedly in CRM, but here there's no domain function at all, not just a missing trigger). Worse, the customer-facing public accept/reject gateway (`resolvePublicQuoteToken`) checks only the separate share-link token's own 1-90-day access-expiry, never the quotation's own commercial `valid_until` — a customer can accept an expired quotation as long as their access link hasn't independently expired. Also no lightweight "extend validity" action (only a full revision, which forces reapproval).
- F039 Discounts: no header/document-level discount mechanism exists — `sales_quotation_charges` is constrained to additive charges only (`value >= 0`), so a discount can only be applied line-by-line, never once across the whole document total.
- F040 Taxes: `tenant.sales_tax_groups`/`sales_tax_group_components`/`tax_group_id` form a complete second tax model in the schema that `calculateLine` never actually queries (it computes CGST/SGST/IGST inline instead) — needs an owner decision (drop the unused schema, matching CRM's F013 precedent, or wire it up for cases the inline logic doesn't cover) rather than a unilateral fix.
- **F041 Approval workflow (cross-module — this is the shared `approval_requests` infrastructure every module's approvals go through, not Sales-specific):** no multi-stage approval chains (one decision point per request only), no delegation (a pending approval's assignee can't be reassigned), no escalation or staleness handling (grepped the whole worker service: nothing ever touches `approval_requests` — a pending approval can sit forever with no system-driven follow-up). Fixing any of these benefits every module using approvals, not just Sales.

## Module order

Following the build order already established in the existing codebase (`apps/web/src/modules/*`, `services/api/src/modules/*`):

1. CRM (30 features) — **production-ready, gap-closing pass complete**
2. Sales (32) — **in progress**
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
- 2026-09-06: CRM gap-closing pass complete — 17 fixes across F003/F004/F005/F006/F008/F009/F010/F015/F019/F026/F028/F029 plus the module-wide automation-trigger wiring, each with a migration where needed (78→84 tenant migrations), real regression tests, and clean `tsc`/`eslint`/`verify:db`/`verify:architecture` after every one. Two corrections found and documented along the way: F008's "merge is unreachable" claim was wrong twice (a bash `**` glob bug), and F028's `custom-field-definitions`/`custom-records` admin UI was real but completely unreachable by any route (fixed as part of F006's work, using the exact wiring pattern discovered while making `qualification-criteria` reachable). Owner confirmed CRM is done for now — remaining items (F007/F008/F009/F014+F016/F021/F025 sub-gaps, AI-001 module-wide) are multi-day feature additions, not gap fixes, and are deliberately deferred rather than done. Moving to Sales next.
- 2026-09-06: Sales trace started with F031 Customer master. Found and immediately fixed two live, cross-cutting security bugs (a cross-company data leak in `getSalesOptions`/`getSalesReport`, and a `sales.margin.view` permission-gate bypass exposing item cost through the same options endpoint) — see the Sales section above and `docs/03-modules/sales/audits/F031-AUDIT.md`. No migration was needed (query-scoping and redaction fixes only); `test:api` (411, up from 409), `typecheck:web` and `verify:db`/`verify:architecture` all clean.
