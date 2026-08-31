# SP015 — Domain events, transactional outbox and event delivery

Working status: `SPECIFICATION_READY`  
Implementation status: `NOT_STARTED`  
Product status: `NOT_READY`

## [SPEC-IDENTITY] Identity
- Shared-platform ID: `SP015`
- Category: **Integration runtime**
- Owner: **Platform**
- Priority: **P0**
- Canonical business count impact: **NONE**.

## [SPEC-INTENT] Intent
Provide reliable domain-event publication from committed state with transactionally consistent outbox, stable event identity and consumer idempotency.

## [SPEC-OUTCOMES] Outcomes
One governed reusable implementation serves all applicable modules; Domain events, transactional outbox and event delivery remains consistent across web, API, worker and mobile.

## [SPEC-PERSONAS] Personas
Tenant administrators, ERP users, managers/approvers, security/operations personnel, integration clients and implementation agents as applicable; negative-permission personas are mandatory.

## [SPEC-ENTRY-POINTS] Entry Points
Administration/settings where configured and protected runtime/API/mobile/worker paths where Domain events, transactional outbox and event delivery is consumed.

## [SPEC-BENCHMARK] Benchmark
Evidence IDs: `SP015-SRC-SP-RFC-9110`, `SP015-SRC-SP-OTEL`.

## [SPEC-DECISION] Decision
`DEC-SP015` freezes this exact shared-platform identity and scope.

## [SPEC-OMISSION-GATE] Omission Gate
Red-team Domain events, transactional outbox and event delivery for lifecycle, authorization, multi-company/tenant scope, stale state, concurrency, retry, recovery, reporting, mobile, accessibility, observability and operations.

## [SPEC-SUBCAPABILITIES] Subcapabilities
Requirement families: `SP015-CAP-###`, `SP015-FR-###`, `SP015-US-###`, `SP015-FLOW-###`, `SP015-BR-###`, `SP015-DATA-###`, `SP015-VAL-###`, `SP015-CALC-###`, `SP015-UX-###`, `SP015-SEC-###`, `SP015-AUTO-###`, `SP015-APP-###`, `SP015-NOTIF-###`, `SP015-REP-###`, `SP015-AI-###`, `SP015-INT-###`, `SP015-API-###`, `SP015-PERF-###`, `SP015-OBS-###`, `SP015-E2E-###`, `SP015-UAT-###`.

## [SPEC-FUNCTIONAL] Functional
Approved FRs: `SP015-FR-001`, `SP015-FR-002`, `SP015-FR-003`.

## [SPEC-FLOWS] Flows
Domain write -> outbox -> dispatcher -> consumer -> acknowledgement -> retry/dead letter -> reconciliation.

## [SPEC-STATE-MACHINE] State Machine
Lifecycle/request/job states for Domain events, transactional outbox and event delivery must be explicit; invalid transitions fail before side effects and recovery/reopen is auditable.

## [SPEC-DATA] Data
Data owned by Domain events, transactional outbox and event delivery is tenant/company scoped where applicable, typed, version/effective-dated when policy changes, and classified for retention/security.

## [SPEC-VALIDATION] Validation
Validate identity/scope, lifecycle, schema, references, stale versions, duplicates and policy before mutation.

## [SPEC-BUSINESS-RULES] Business Rules
- Business commit and required outbox record share a transaction.
- Event IDs are stable across retries.
- Consumers treat delivery as at-least-once unless a stronger contract is explicitly proven.

## [SPEC-CALCULATIONS] Calculations
Any quotas/windows/usage/retry/timestamp-derived values in Domain events, transactional outbox and event delivery use explicit deterministic precision/timezone rules.

## [SPEC-VIEWS] Views
Provide only justified admin/operator views for Domain events, transactional outbox and event delivery using Experience Kernel states.

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
Dependencies: SP014.

## [SPEC-AUTOMATION] Automation
Automation consumes Domain events, transactional outbox and event delivery only through normal public commands/authorization.

## [SPEC-APPROVALS] Approvals
Use centralized approval/SoD when changing Domain events, transactional outbox and event delivery materially affects security, money, access, data exposure or production operations.

## [SPEC-NOTIFICATIONS] Notifications
Notify responsible actors for actionable Domain events, transactional outbox and event delivery failures, approvals, expirations or security events.

## [SPEC-DOCUMENTS] Documents
Documents/attachments used by Domain events, transactional outbox and event delivery obey SP019 file security, scope, version and retention.

## [SPEC-IMPORT-EXPORT] Import Export
Import/export of Domain events, transactional outbox and event delivery configuration/evidence is permission-scoped, validated and auditable.

## [SPEC-REPORTING] Reporting
Report health, usage, exceptions, audit and policy state for Domain events, transactional outbox and event delivery, including source/freshness.

## [SPEC-AI] Ai
AI may assist/explain Domain events, transactional outbox and event delivery only from authorized context and cannot bypass deterministic controls.

## [SPEC-SECURITY] Security
Lost events, duplicate effects, reordered assumptions and cross-tenant event routing are primary threats. Security-negative and abuse tests are mandatory.

## [SPEC-SCOPE] Scope
Resolve organization, entitlement, company, branch/site/team/record/field context as applicable; jobs/integrations use trusted persisted scope.

## [SPEC-AUDIT] Audit
Sensitive/high-impact Domain events, transactional outbox and event delivery changes produce durable actor/tenant/target/correlation evidence with secret/PII minimization.

## [SPEC-CONCURRENCY] Concurrency
Identify races in Domain events, transactional outbox and event delivery; enforce DB constraints/locks/version checks or another documented safe mechanism.

## [SPEC-IDEMPOTENCY] Idempotency
Retries in Domain events, transactional outbox and event delivery are classified; unsafe duplicate effects use stable idempotency/business keys and reconciliation.

## [SPEC-INTEGRATIONS] Integrations
Integration contracts involving Domain events, transactional outbox and event delivery are versioned, tenant-scoped, observable and replay-safe.

## [SPEC-API] Api
APIs use authenticated/versioned contracts, object/function/property authorization, bounded resource use and typed errors.

## [SPEC-MOBILE] Mobile
Classify Domain events, transactional outbox and event delivery as full, field-optimized, approval-only, read-only or not-applicable; offline state is bounded/encrypted and revalidated.

## [SPEC-RESPONSIVE] Responsive
Desktop/tablet/phone behavior follows the Experience Kernel and preserves critical actions.

## [SPEC-ACCESSIBILITY] Accessibility
WCAG 2.2 AA intent: keyboard/focus, labels, screen-reader status/errors, contrast, target size, zoom/reflow, reduced motion and non-drag alternatives.

## [SPEC-VISUAL-EVIDENCE] Visual Evidence
Complex Domain events, transactional outbox and event delivery admin/operator surfaces require wireframes/state diagrams before implementation.

## [SPEC-PERFORMANCE] Performance
Define latency/throughput/cardinality/volume budgets for Domain events, transactional outbox and event delivery; use batching/pagination/async/read models where appropriate.

## [SPEC-OBSERVABILITY] Observability
Structured logs/metrics/traces with correlation, diagnostics, alerts and reconciliation support are required for Domain events, transactional outbox and event delivery.

## [SPEC-EDGE-CASES] Edge Cases
Cover duplicates, stale references, concurrency, permission changes, partial failures, retries, outages, timezones/localization and recovery.

## [SPEC-CODE-AUDIT] Code Audit
Before implementation, map current repository paths/symbols to SP015 and classify VERIFIED/PARTIAL/MISSING; code never lowers target requirements.

## [SPEC-GAPS] Gaps
Target minus verified behavior is the implementation gap; framework existence alone is not proof that Domain events, transactional outbox and event delivery is complete.

## [SPEC-IMPLEMENTATION] Implementation
Implement in existing core/packages/worker/database/mobile/shared areas as appropriate; business modules consume public contracts. Pass A changes docs only.

## [SPEC-TESTS] Tests
Unit/domain, DB/RLS, API, security-negative, integration, idempotency/retry, performance, migration and reconciliation tests are planned.

## [SPEC-E2E] E2E
`SP015-TEST-E2E-01` happy path and `SP015-TEST-E2E-02` negative/recovery path are planned.

## [SPEC-UAT] Uat
`SP015-UAT-01` and `SP015-UAT-02` cover primary and failure/permission/recovery validation.

## [SPEC-DOD] Dod
SP015 is specification-ready because identity/scope, atomic requirements, primary evidence, decisions, dependencies, tests and UAT are materialized. It is not implementation/product ready.

## [SPEC-OPEN-DECISIONS] Open Decisions
No freeze-blocking identity/scope decision remains; implementation-specific choices remain governed by existing ADR/change control.
