# SP004 — Identity and user lifecycle

Working status: `SPECIFICATION_READY`  
Implementation status: `NOT_STARTED`  
Product status: `NOT_READY`

## [SPEC-IDENTITY] Identity
- Shared-platform ID: `SP004`
- Category: **Identity & access**
- Owner: **Platform**
- Priority: **P0**
- Canonical business count impact: **NONE**.

## [SPEC-INTENT] Intent
Manage user identity, invitation, activation, deactivation, profile linkage and lifecycle across tenants without sharing credentials or permissions between organizations.

## [SPEC-OUTCOMES] Outcomes
One governed reusable implementation serves all applicable modules; Identity and user lifecycle remains consistent across web, API, worker and mobile.

## [SPEC-PERSONAS] Personas
Tenant administrators, ERP users, managers/approvers, security/operations personnel, integration clients and implementation agents as applicable; negative-permission personas are mandatory.

## [SPEC-ENTRY-POINTS] Entry Points
Administration/settings where configured and protected runtime/API/mobile/worker paths where Identity and user lifecycle is consumed.

## [SPEC-BENCHMARK] Benchmark
Evidence IDs: `SP004-SRC-SP-NIST-63-4`, `SP004-SRC-SP-OWASP-API`.

## [SPEC-DECISION] Decision
`DEC-SP004` freezes this exact shared-platform identity and scope.

## [SPEC-OMISSION-GATE] Omission Gate
Red-team Identity and user lifecycle for lifecycle, authorization, multi-company/tenant scope, stale state, concurrency, retry, recovery, reporting, mobile, accessibility, observability and operations.

## [SPEC-SUBCAPABILITIES] Subcapabilities
Requirement families: `SP004-CAP-###`, `SP004-FR-###`, `SP004-US-###`, `SP004-FLOW-###`, `SP004-BR-###`, `SP004-DATA-###`, `SP004-VAL-###`, `SP004-CALC-###`, `SP004-UX-###`, `SP004-SEC-###`, `SP004-AUTO-###`, `SP004-APP-###`, `SP004-NOTIF-###`, `SP004-REP-###`, `SP004-AI-###`, `SP004-INT-###`, `SP004-API-###`, `SP004-PERF-###`, `SP004-OBS-###`, `SP004-E2E-###`, `SP004-UAT-###`.

## [SPEC-FUNCTIONAL] Functional
Approved FRs: `SP004-FR-001`, `SP004-FR-002`, `SP004-FR-003`.

## [SPEC-FLOWS] Flows
Invite -> verify -> join organization -> assign access -> active use -> suspend/deactivate -> preserve audit attribution.

## [SPEC-STATE-MACHINE] State Machine
Lifecycle/request/job states for Identity and user lifecycle must be explicit; invalid transitions fail before side effects and recovery/reopen is auditable.

## [SPEC-DATA] Data
Data owned by Identity and user lifecycle is tenant/company scoped where applicable, typed, version/effective-dated when policy changes, and classified for retention/security.

## [SPEC-VALIDATION] Validation
Validate identity/scope, lifecycle, schema, references, stale versions, duplicates and policy before mutation.

## [SPEC-BUSINESS-RULES] Business Rules
- User identity and organization membership are separate concepts.
- Deactivation terminates future access without deleting historical actor attribution.
- Invitation/acceptance is single-use and expiration-aware.

## [SPEC-CALCULATIONS] Calculations
Any quotas/windows/usage/retry/timestamp-derived values in Identity and user lifecycle use explicit deterministic precision/timezone rules.

## [SPEC-VIEWS] Views
Provide only justified admin/operator views for Identity and user lifecycle using Experience Kernel states.

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
Automation consumes Identity and user lifecycle only through normal public commands/authorization.

## [SPEC-APPROVALS] Approvals
Use centralized approval/SoD when changing Identity and user lifecycle materially affects security, money, access, data exposure or production operations.

## [SPEC-NOTIFICATIONS] Notifications
Notify responsible actors for actionable Identity and user lifecycle failures, approvals, expirations or security events.

## [SPEC-DOCUMENTS] Documents
Documents/attachments used by Identity and user lifecycle obey SP019 file security, scope, version and retention.

## [SPEC-IMPORT-EXPORT] Import Export
Import/export of Identity and user lifecycle configuration/evidence is permission-scoped, validated and auditable.

## [SPEC-REPORTING] Reporting
Report health, usage, exceptions, audit and policy state for Identity and user lifecycle, including source/freshness.

## [SPEC-AI] Ai
AI may assist/explain Identity and user lifecycle only from authorized context and cannot bypass deterministic controls.

## [SPEC-SECURITY] Security
Account enumeration, invitation replay, orphaned privileged memberships and identity collision are primary threats. Security-negative and abuse tests are mandatory.

## [SPEC-SCOPE] Scope
Resolve organization, entitlement, company, branch/site/team/record/field context as applicable; jobs/integrations use trusted persisted scope.

## [SPEC-AUDIT] Audit
Sensitive/high-impact Identity and user lifecycle changes produce durable actor/tenant/target/correlation evidence with secret/PII minimization.

## [SPEC-CONCURRENCY] Concurrency
Identify races in Identity and user lifecycle; enforce DB constraints/locks/version checks or another documented safe mechanism.

## [SPEC-IDEMPOTENCY] Idempotency
Retries in Identity and user lifecycle are classified; unsafe duplicate effects use stable idempotency/business keys and reconciliation.

## [SPEC-INTEGRATIONS] Integrations
Integration contracts involving Identity and user lifecycle are versioned, tenant-scoped, observable and replay-safe.

## [SPEC-API] Api
APIs use authenticated/versioned contracts, object/function/property authorization, bounded resource use and typed errors.

## [SPEC-MOBILE] Mobile
Classify Identity and user lifecycle as full, field-optimized, approval-only, read-only or not-applicable; offline state is bounded/encrypted and revalidated.

## [SPEC-RESPONSIVE] Responsive
Desktop/tablet/phone behavior follows the Experience Kernel and preserves critical actions.

## [SPEC-ACCESSIBILITY] Accessibility
WCAG 2.2 AA intent: keyboard/focus, labels, screen-reader status/errors, contrast, target size, zoom/reflow, reduced motion and non-drag alternatives.

## [SPEC-VISUAL-EVIDENCE] Visual Evidence
Complex Identity and user lifecycle admin/operator surfaces require wireframes/state diagrams before implementation.

## [SPEC-PERFORMANCE] Performance
Define latency/throughput/cardinality/volume budgets for Identity and user lifecycle; use batching/pagination/async/read models where appropriate.

## [SPEC-OBSERVABILITY] Observability
Structured logs/metrics/traces with correlation, diagnostics, alerts and reconciliation support are required for Identity and user lifecycle.

## [SPEC-EDGE-CASES] Edge Cases
Cover duplicates, stale references, concurrency, permission changes, partial failures, retries, outages, timezones/localization and recovery.

## [SPEC-CODE-AUDIT] Code Audit
Before implementation, map current repository paths/symbols to SP004 and classify VERIFIED/PARTIAL/MISSING; code never lowers target requirements.

## [SPEC-GAPS] Gaps
Target minus verified behavior is the implementation gap; framework existence alone is not proof that Identity and user lifecycle is complete.

## [SPEC-IMPLEMENTATION] Implementation
Implement in existing core/packages/worker/database/mobile/shared areas as appropriate; business modules consume public contracts. Pass A changes docs only.

## [SPEC-TESTS] Tests
Unit/domain, DB/RLS, API, security-negative, integration, idempotency/retry, performance, migration and reconciliation tests are planned.

## [SPEC-E2E] E2E
`SP004-TEST-E2E-01` happy path and `SP004-TEST-E2E-02` negative/recovery path are planned.

## [SPEC-UAT] Uat
`SP004-UAT-01` and `SP004-UAT-02` cover primary and failure/permission/recovery validation.

## [SPEC-DOD] Dod
SP004 is specification-ready because identity/scope, atomic requirements, primary evidence, decisions, dependencies, tests and UAT are materialized. It is not implementation/product ready.

## [SPEC-OPEN-DECISIONS] Open Decisions
No freeze-blocking identity/scope decision remains; implementation-specific choices remain governed by existing ADR/change control.
