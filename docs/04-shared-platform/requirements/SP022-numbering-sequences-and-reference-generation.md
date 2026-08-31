# SP022 — Numbering, sequences and reference generation

Working status: `SPECIFICATION_READY`  
Implementation status: `NOT_STARTED`  
Product status: `NOT_READY`

## [SPEC-IDENTITY] Identity
- Shared-platform ID: `SP022`
- Category: **Configuration & extensibility**
- Owner: **Platform**
- Priority: **P1**
- Canonical business count impact: **NONE**.

## [SPEC-INTENT] Intent
Provide company/module/document-aware human reference numbers with concurrency safety, configurable prefixes/resets and immutable issued identity where required.

## [SPEC-OUTCOMES] Outcomes
One governed reusable implementation serves all applicable modules; Numbering, sequences and reference generation remains consistent across web, API, worker and mobile.

## [SPEC-PERSONAS] Personas
Tenant administrators, ERP users, managers/approvers, security/operations personnel, integration clients and implementation agents as applicable; negative-permission personas are mandatory.

## [SPEC-ENTRY-POINTS] Entry Points
Administration/settings where configured and protected runtime/API/mobile/worker paths where Numbering, sequences and reference generation is consumed.

## [SPEC-BENCHMARK] Benchmark
Evidence IDs: `SP022-SRC-SP-PG-RLS`, `SP022-SRC-SP-RFC-9110`.

## [SPEC-DECISION] Decision
`DEC-SP022` freezes this exact shared-platform identity and scope.

## [SPEC-OMISSION-GATE] Omission Gate
Red-team Numbering, sequences and reference generation for lifecycle, authorization, multi-company/tenant scope, stale state, concurrency, retry, recovery, reporting, mobile, accessibility, observability and operations.

## [SPEC-SUBCAPABILITIES] Subcapabilities
Requirement families: `SP022-CAP-###`, `SP022-FR-###`, `SP022-US-###`, `SP022-FLOW-###`, `SP022-BR-###`, `SP022-DATA-###`, `SP022-VAL-###`, `SP022-CALC-###`, `SP022-UX-###`, `SP022-SEC-###`, `SP022-AUTO-###`, `SP022-APP-###`, `SP022-NOTIF-###`, `SP022-REP-###`, `SP022-AI-###`, `SP022-INT-###`, `SP022-API-###`, `SP022-PERF-###`, `SP022-OBS-###`, `SP022-E2E-###`, `SP022-UAT-###`.

## [SPEC-FUNCTIONAL] Functional
Approved FRs: `SP022-FR-001`, `SP022-FR-002`, `SP022-FR-003`.

## [SPEC-FLOWS] Flows
Configure sequence -> request number inside domain transaction -> reserve/issue -> display/search -> reset by defined boundary.

## [SPEC-STATE-MACHINE] State Machine
Lifecycle/request/job states for Numbering, sequences and reference generation must be explicit; invalid transitions fail before side effects and recovery/reopen is auditable.

## [SPEC-DATA] Data
Data owned by Numbering, sequences and reference generation is tenant/company scoped where applicable, typed, version/effective-dated when policy changes, and classified for retention/security.

## [SPEC-VALIDATION] Validation
Validate identity/scope, lifecycle, schema, references, stale versions, duplicates and policy before mutation.

## [SPEC-BUSINESS-RULES] Business Rules
- Concurrent issuance cannot create duplicates.
- Posted/official numbers are not silently reused.
- Gap policy is configurable/documented rather than falsely promising gaplessness under rollback.

## [SPEC-CALCULATIONS] Calculations
Any quotas/windows/usage/retry/timestamp-derived values in Numbering, sequences and reference generation use explicit deterministic precision/timezone rules.

## [SPEC-VIEWS] Views
Provide only justified admin/operator views for Numbering, sequences and reference generation using Experience Kernel states.

## [SPEC-LIST] List
Permission-scoped, paginated/virtualized where needed, and consistent with direct-record authorization.

## [SPEC-SEARCH] Search
Search/filter obey identical row/field authorization and freshness semantics.

## [SPEC-DETAIL] Detail
Expose effective configuration/state, related evidence, last change, health and actionable errors appropriate to role.

## [SPEC-CREATE] Create
Creation/configuration uses validated defaults, explicit scope, conflict-safe identity and audit.

## [SPEC-EDIT] Edit
Edits use stale-write protection where needed; high-impact changes may require approval/step-up.

## [SPEC-BULK] Bulk
Bulk changes preserve per-record authorization/rules and expose progress/errors/reconciliation.

## [SPEC-ACTIONS] Actions
All actions map to server commands with permission, transition and idempotency semantics.

## [SPEC-RELATED] Related
Dependencies: SP002,SP026.

## [SPEC-AUTOMATION] Automation
Automation consumes Numbering, sequences and reference generation only through normal public commands/authorization.

## [SPEC-APPROVALS] Approvals
Use centralized approval/SoD when changing Numbering, sequences and reference generation materially affects security, money, access, data exposure or production operations.

## [SPEC-NOTIFICATIONS] Notifications
Notify responsible actors for actionable Numbering, sequences and reference generation failures, approvals, expirations or security events.

## [SPEC-DOCUMENTS] Documents
Documents/attachments used by Numbering, sequences and reference generation obey SP019 file security, scope, version and retention.

## [SPEC-IMPORT-EXPORT] Import Export
Import/export of Numbering, sequences and reference generation configuration/evidence is permission-scoped, validated and auditable.

## [SPEC-REPORTING] Reporting
Report health, usage, exceptions, audit and policy state for Numbering, sequences and reference generation, including source/freshness.

## [SPEC-AI] Ai
AI may assist/explain Numbering, sequences and reference generation only from authorized context and cannot bypass deterministic controls.

## [SPEC-SECURITY] Security
Duplicate numbers, race conditions, retroactive renumbering and cross-company sequence leakage are primary threats. Security-negative and abuse tests are mandatory.

## [SPEC-SCOPE] Scope
Resolve organization, entitlement, company, branch/site/team/record/field context as applicable; jobs/integrations use trusted persisted scope.

## [SPEC-AUDIT] Audit
Sensitive/high-impact Numbering, sequences and reference generation changes produce durable actor/tenant/target/correlation evidence with secret/PII minimization.

## [SPEC-CONCURRENCY] Concurrency
Identify races in Numbering, sequences and reference generation; enforce DB constraints/locks/version checks or another documented safe mechanism.

## [SPEC-IDEMPOTENCY] Idempotency
Retries in Numbering, sequences and reference generation are classified; unsafe duplicate effects use stable idempotency/business keys and reconciliation.

## [SPEC-INTEGRATIONS] Integrations
Integration contracts involving Numbering, sequences and reference generation are versioned, tenant-scoped, observable and replay-safe.

## [SPEC-API] Api
APIs use authenticated/versioned contracts, object/function/property authorization, bounded resource use and typed errors.

## [SPEC-MOBILE] Mobile
Classify Numbering, sequences and reference generation as full, field-optimized, approval-only, read-only or not-applicable; offline state is bounded/encrypted and revalidated.

## [SPEC-RESPONSIVE] Responsive
Desktop/tablet/phone behavior follows the Experience Kernel and preserves critical actions.

## [SPEC-ACCESSIBILITY] Accessibility
WCAG 2.2 AA intent: keyboard/focus, labels, screen-reader status/errors, contrast, target size, zoom/reflow, reduced motion and non-drag alternatives.

## [SPEC-VISUAL-EVIDENCE] Visual Evidence
Complex Numbering, sequences and reference generation admin/operator surfaces require wireframes/state diagrams before implementation.

## [SPEC-PERFORMANCE] Performance
Define latency/throughput/cardinality/volume budgets for Numbering, sequences and reference generation; use batching/pagination/async/read models where appropriate.

## [SPEC-OBSERVABILITY] Observability
Structured logs/metrics/traces with correlation, diagnostics, alerts and reconciliation support are required for Numbering, sequences and reference generation.

## [SPEC-EDGE-CASES] Edge Cases
Cover duplicates, stale references, concurrency, permission changes, partial failures, retries, outages, timezones/localization and recovery.

## [SPEC-CODE-AUDIT] Code Audit
Before implementation, map current repository paths/symbols to SP022 and classify VERIFIED/PARTIAL/MISSING; code never lowers target requirements.

## [SPEC-GAPS] Gaps
Target minus verified behavior is the implementation gap; framework existence alone is not proof that Numbering, sequences and reference generation is complete.

## [SPEC-IMPLEMENTATION] Implementation
Implement in existing core/packages/worker/database/mobile/shared areas as appropriate; business modules consume public contracts. Pass A changes docs only.

## [SPEC-TESTS] Tests
Unit/domain, DB/RLS, API, security-negative, integration, idempotency/retry, performance, migration and reconciliation tests are planned.

## [SPEC-E2E] E2E
`SP022-TEST-E2E-01` happy path and `SP022-TEST-E2E-02` negative/recovery path are planned.

## [SPEC-UAT] Uat
`SP022-UAT-01` and `SP022-UAT-02` cover primary and failure/permission/recovery validation.

## [SPEC-DOD] Dod
SP022 is specification-ready because identity/scope, atomic requirements, primary evidence, decisions, dependencies, tests and UAT are materialized. It is not implementation/product ready.

## [SPEC-OPEN-DECISIONS] Open Decisions
No freeze-blocking identity/scope decision remains; implementation-specific choices remain governed by existing ADR/change control.
