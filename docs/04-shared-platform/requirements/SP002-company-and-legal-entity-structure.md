# SP002 — Company and legal-entity structure

Working status: `SPECIFICATION_READY`  
Implementation status: `NOT_STARTED`  
Product status: `NOT_READY`

## [SPEC-IDENTITY] Identity
- Shared-platform ID: `SP002`
- Category: **Identity & tenancy**
- Owner: **Platform**
- Priority: **P0**
- Canonical business count impact: **NONE**.

## [SPEC-INTENT] Intent
Model legal/business companies inside a tenant, including active state, base currency, fiscal/tax context and controlled access boundaries.

## [SPEC-OUTCOMES] Outcomes
One governed reusable implementation serves all applicable modules; Company and legal-entity structure remains consistent across web, API, worker and mobile.

## [SPEC-PERSONAS] Personas
Tenant administrators, ERP users, managers/approvers, security/operations personnel, integration clients and implementation agents as applicable; negative-permission personas are mandatory.

## [SPEC-ENTRY-POINTS] Entry Points
Administration/settings where configured and protected runtime/API/mobile/worker paths where Company and legal-entity structure is consumed.

## [SPEC-BENCHMARK] Benchmark
Evidence IDs: `SP002-SRC-SP-PG-RLS`, `SP002-SRC-SP-OWASP-API`, `SP002-SRC-SP-CLDR-48`.

## [SPEC-DECISION] Decision
`DEC-SP002` freezes this exact shared-platform identity and scope.

## [SPEC-OMISSION-GATE] Omission Gate
Red-team Company and legal-entity structure for lifecycle, authorization, multi-company/tenant scope, stale state, concurrency, retry, recovery, reporting, mobile, accessibility, observability and operations.

## [SPEC-SUBCAPABILITIES] Subcapabilities
Requirement families: `SP002-CAP-###`, `SP002-FR-###`, `SP002-US-###`, `SP002-FLOW-###`, `SP002-BR-###`, `SP002-DATA-###`, `SP002-VAL-###`, `SP002-CALC-###`, `SP002-UX-###`, `SP002-SEC-###`, `SP002-AUTO-###`, `SP002-APP-###`, `SP002-NOTIF-###`, `SP002-REP-###`, `SP002-AI-###`, `SP002-INT-###`, `SP002-API-###`, `SP002-PERF-###`, `SP002-OBS-###`, `SP002-E2E-###`, `SP002-UAT-###`.

## [SPEC-FUNCTIONAL] Functional
Approved FRs: `SP002-FR-001`, `SP002-FR-002`, `SP002-FR-003`.

## [SPEC-FLOWS] Flows
Admin configures company; user selects/receives active company scope; commands validate company membership and legal-entity rules.

## [SPEC-STATE-MACHINE] State Machine
Lifecycle/request/job states for Company and legal-entity structure must be explicit; invalid transitions fail before side effects and recovery/reopen is auditable.

## [SPEC-DATA] Data
Data owned by Company and legal-entity structure is tenant/company scoped where applicable, typed, version/effective-dated when policy changes, and classified for retention/security.

## [SPEC-VALIDATION] Validation
Validate identity/scope, lifecycle, schema, references, stale versions, duplicates and policy before mutation.

## [SPEC-BUSINESS-RULES] Business Rules
- A record never silently changes company ownership.
- Cross-company actions require explicit scope and public contracts.
- Company disablement cannot orphan posted business truth.

## [SPEC-CALCULATIONS] Calculations
Any quotas/windows/usage/retry/timestamp-derived values in Company and legal-entity structure use explicit deterministic precision/timezone rules.

## [SPEC-VIEWS] Views
Provide only justified admin/operator views for Company and legal-entity structure using Experience Kernel states.

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
Dependencies: SP001.

## [SPEC-AUTOMATION] Automation
Automation consumes Company and legal-entity structure only through normal public commands/authorization.

## [SPEC-APPROVALS] Approvals
Use centralized approval/SoD when changing Company and legal-entity structure materially affects security, money, access, data exposure or production operations.

## [SPEC-NOTIFICATIONS] Notifications
Notify responsible actors for actionable Company and legal-entity structure failures, approvals, expirations or security events.

## [SPEC-DOCUMENTS] Documents
Documents/attachments used by Company and legal-entity structure obey SP019 file security, scope, version and retention.

## [SPEC-IMPORT-EXPORT] Import Export
Import/export of Company and legal-entity structure configuration/evidence is permission-scoped, validated and auditable.

## [SPEC-REPORTING] Reporting
Report health, usage, exceptions, audit and policy state for Company and legal-entity structure, including source/freshness.

## [SPEC-AI] Ai
AI may assist/explain Company and legal-entity structure only from authorized context and cannot bypass deterministic controls.

## [SPEC-SECURITY] Security
Cross-company IDOR, hidden company-switch persistence and invalid consolidation scope are primary threats. Security-negative and abuse tests are mandatory.

## [SPEC-SCOPE] Scope
Resolve organization, entitlement, company, branch/site/team/record/field context as applicable; jobs/integrations use trusted persisted scope.

## [SPEC-AUDIT] Audit
Sensitive/high-impact Company and legal-entity structure changes produce durable actor/tenant/target/correlation evidence with secret/PII minimization.

## [SPEC-CONCURRENCY] Concurrency
Identify races in Company and legal-entity structure; enforce DB constraints/locks/version checks or another documented safe mechanism.

## [SPEC-IDEMPOTENCY] Idempotency
Retries in Company and legal-entity structure are classified; unsafe duplicate effects use stable idempotency/business keys and reconciliation.

## [SPEC-INTEGRATIONS] Integrations
Integration contracts involving Company and legal-entity structure are versioned, tenant-scoped, observable and replay-safe.

## [SPEC-API] Api
APIs use authenticated/versioned contracts, object/function/property authorization, bounded resource use and typed errors.

## [SPEC-MOBILE] Mobile
Classify Company and legal-entity structure as full, field-optimized, approval-only, read-only or not-applicable; offline state is bounded/encrypted and revalidated.

## [SPEC-RESPONSIVE] Responsive
Desktop/tablet/phone behavior follows the Experience Kernel and preserves critical actions.

## [SPEC-ACCESSIBILITY] Accessibility
WCAG 2.2 AA intent: keyboard/focus, labels, screen-reader status/errors, contrast, target size, zoom/reflow, reduced motion and non-drag alternatives.

## [SPEC-VISUAL-EVIDENCE] Visual Evidence
Complex Company and legal-entity structure admin/operator surfaces require wireframes/state diagrams before implementation.

## [SPEC-PERFORMANCE] Performance
Define latency/throughput/cardinality/volume budgets for Company and legal-entity structure; use batching/pagination/async/read models where appropriate.

## [SPEC-OBSERVABILITY] Observability
Structured logs/metrics/traces with correlation, diagnostics, alerts and reconciliation support are required for Company and legal-entity structure.

## [SPEC-EDGE-CASES] Edge Cases
Cover duplicates, stale references, concurrency, permission changes, partial failures, retries, outages, timezones/localization and recovery.

## [SPEC-CODE-AUDIT] Code Audit
Before implementation, map current repository paths/symbols to SP002 and classify VERIFIED/PARTIAL/MISSING; code never lowers target requirements.

## [SPEC-GAPS] Gaps
Target minus verified behavior is the implementation gap; framework existence alone is not proof that Company and legal-entity structure is complete.

## [SPEC-IMPLEMENTATION] Implementation
Implement in existing core/packages/worker/database/mobile/shared areas as appropriate; business modules consume public contracts. Pass A changes docs only.

## [SPEC-TESTS] Tests
Unit/domain, DB/RLS, API, security-negative, integration, idempotency/retry, performance, migration and reconciliation tests are planned.

## [SPEC-E2E] E2E
`SP002-TEST-E2E-01` happy path and `SP002-TEST-E2E-02` negative/recovery path are planned.

## [SPEC-UAT] Uat
`SP002-UAT-01` and `SP002-UAT-02` cover primary and failure/permission/recovery validation.

## [SPEC-DOD] Dod
SP002 is specification-ready because identity/scope, atomic requirements, primary evidence, decisions, dependencies, tests and UAT are materialized. It is not implementation/product ready.

## [SPEC-OPEN-DECISIONS] Open Decisions
No freeze-blocking identity/scope decision remains; implementation-specific choices remain governed by existing ADR/change control.
