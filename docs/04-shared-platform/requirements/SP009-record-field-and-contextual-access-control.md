# SP009 — Record, field and contextual access control

Working status: `SPECIFICATION_READY`  
Implementation status: `NOT_STARTED`  
Product status: `NOT_READY`

## [SPEC-IDENTITY] Identity
- Shared-platform ID: `SP009`
- Category: **Authorization**
- Owner: **Security**
- Priority: **P0**
- Canonical business count impact: **NONE**.

## [SPEC-INTENT] Intent
Enforce company/branch/team/owner/record/field visibility and mutation scope in addition to coarse module permissions.

## [SPEC-OUTCOMES] Outcomes
One governed reusable implementation serves all applicable modules; Record, field and contextual access control remains consistent across web, API, worker and mobile.

## [SPEC-PERSONAS] Personas
Tenant administrators, ERP users, managers/approvers, security/operations personnel, integration clients and implementation agents as applicable; negative-permission personas are mandatory.

## [SPEC-ENTRY-POINTS] Entry Points
Administration/settings where configured and protected runtime/API/mobile/worker paths where Record, field and contextual access control is consumed.

## [SPEC-BENCHMARK] Benchmark
Evidence IDs: `SP009-SRC-SP-OWASP-API`, `SP009-SRC-SP-PG-RLS`.

## [SPEC-DECISION] Decision
`DEC-SP009` freezes this exact shared-platform identity and scope.

## [SPEC-OMISSION-GATE] Omission Gate
Red-team Record, field and contextual access control for lifecycle, authorization, multi-company/tenant scope, stale state, concurrency, retry, recovery, reporting, mobile, accessibility, observability and operations.

## [SPEC-SUBCAPABILITIES] Subcapabilities
Requirement families: `SP009-CAP-###`, `SP009-FR-###`, `SP009-US-###`, `SP009-FLOW-###`, `SP009-BR-###`, `SP009-DATA-###`, `SP009-VAL-###`, `SP009-CALC-###`, `SP009-UX-###`, `SP009-SEC-###`, `SP009-AUTO-###`, `SP009-APP-###`, `SP009-NOTIF-###`, `SP009-REP-###`, `SP009-AI-###`, `SP009-INT-###`, `SP009-API-###`, `SP009-PERF-###`, `SP009-OBS-###`, `SP009-E2E-###`, `SP009-UAT-###`.

## [SPEC-FUNCTIONAL] Functional
Approved FRs: `SP009-FR-001`, `SP009-FR-002`, `SP009-FR-003`.

## [SPEC-FLOWS] Flows
Resolve actor context -> compute allowed record/field scope -> filter/query/write -> deny indistinguishably where IDOR risk exists.

## [SPEC-STATE-MACHINE] State Machine
Lifecycle/request/job states for Record, field and contextual access control must be explicit; invalid transitions fail before side effects and recovery/reopen is auditable.

## [SPEC-DATA] Data
Data owned by Record, field and contextual access control is tenant/company scoped where applicable, typed, version/effective-dated when policy changes, and classified for retention/security.

## [SPEC-VALIDATION] Validation
Validate identity/scope, lifecycle, schema, references, stale versions, duplicates and policy before mutation.

## [SPEC-BUSINESS-RULES] Business Rules
- Direct-ID reads and writes apply the same scope as list/search.
- Sensitive fields have explicit read/write policy.
- RLS/default-deny complements application authorization for tenant isolation.

## [SPEC-CALCULATIONS] Calculations
Any quotas/windows/usage/retry/timestamp-derived values in Record, field and contextual access control use explicit deterministic precision/timezone rules.

## [SPEC-VIEWS] Views
Provide only justified admin/operator views for Record, field and contextual access control using Experience Kernel states.

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
Dependencies: SP001,SP002,SP003,SP008.

## [SPEC-AUTOMATION] Automation
Automation consumes Record, field and contextual access control only through normal public commands/authorization.

## [SPEC-APPROVALS] Approvals
Use centralized approval/SoD when changing Record, field and contextual access control materially affects security, money, access, data exposure or production operations.

## [SPEC-NOTIFICATIONS] Notifications
Notify responsible actors for actionable Record, field and contextual access control failures, approvals, expirations or security events.

## [SPEC-DOCUMENTS] Documents
Documents/attachments used by Record, field and contextual access control obey SP019 file security, scope, version and retention.

## [SPEC-IMPORT-EXPORT] Import Export
Import/export of Record, field and contextual access control configuration/evidence is permission-scoped, validated and auditable.

## [SPEC-REPORTING] Reporting
Report health, usage, exceptions, audit and policy state for Record, field and contextual access control, including source/freshness.

## [SPEC-AI] Ai
AI may assist/explain Record, field and contextual access control only from authorized context and cannot bypass deterministic controls.

## [SPEC-SECURITY] Security
BOLA/IDOR, mass assignment, field leakage, list/detail mismatch and cross-tenant access are primary threats. Security-negative and abuse tests are mandatory.

## [SPEC-SCOPE] Scope
Resolve organization, entitlement, company, branch/site/team/record/field context as applicable; jobs/integrations use trusted persisted scope.

## [SPEC-AUDIT] Audit
Sensitive/high-impact Record, field and contextual access control changes produce durable actor/tenant/target/correlation evidence with secret/PII minimization.

## [SPEC-CONCURRENCY] Concurrency
Identify races in Record, field and contextual access control; enforce DB constraints/locks/version checks or another documented safe mechanism.

## [SPEC-IDEMPOTENCY] Idempotency
Retries in Record, field and contextual access control are classified; unsafe duplicate effects use stable idempotency/business keys and reconciliation.

## [SPEC-INTEGRATIONS] Integrations
Integration contracts involving Record, field and contextual access control are versioned, tenant-scoped, observable and replay-safe.

## [SPEC-API] Api
APIs use authenticated/versioned contracts, object/function/property authorization, bounded resource use and typed errors.

## [SPEC-MOBILE] Mobile
Classify Record, field and contextual access control as full, field-optimized, approval-only, read-only or not-applicable; offline state is bounded/encrypted and revalidated.

## [SPEC-RESPONSIVE] Responsive
Desktop/tablet/phone behavior follows the Experience Kernel and preserves critical actions.

## [SPEC-ACCESSIBILITY] Accessibility
WCAG 2.2 AA intent: keyboard/focus, labels, screen-reader status/errors, contrast, target size, zoom/reflow, reduced motion and non-drag alternatives.

## [SPEC-VISUAL-EVIDENCE] Visual Evidence
Complex Record, field and contextual access control admin/operator surfaces require wireframes/state diagrams before implementation.

## [SPEC-PERFORMANCE] Performance
Define latency/throughput/cardinality/volume budgets for Record, field and contextual access control; use batching/pagination/async/read models where appropriate.

## [SPEC-OBSERVABILITY] Observability
Structured logs/metrics/traces with correlation, diagnostics, alerts and reconciliation support are required for Record, field and contextual access control.

## [SPEC-EDGE-CASES] Edge Cases
Cover duplicates, stale references, concurrency, permission changes, partial failures, retries, outages, timezones/localization and recovery.

## [SPEC-CODE-AUDIT] Code Audit
Before implementation, map current repository paths/symbols to SP009 and classify VERIFIED/PARTIAL/MISSING; code never lowers target requirements.

## [SPEC-GAPS] Gaps
Target minus verified behavior is the implementation gap; framework existence alone is not proof that Record, field and contextual access control is complete.

## [SPEC-IMPLEMENTATION] Implementation
Implement in existing core/packages/worker/database/mobile/shared areas as appropriate; business modules consume public contracts. Pass A changes docs only.

## [SPEC-TESTS] Tests
Unit/domain, DB/RLS, API, security-negative, integration, idempotency/retry, performance, migration and reconciliation tests are planned.

## [SPEC-E2E] E2E
`SP009-TEST-E2E-01` happy path and `SP009-TEST-E2E-02` negative/recovery path are planned.

## [SPEC-UAT] Uat
`SP009-UAT-01` and `SP009-UAT-02` cover primary and failure/permission/recovery validation.

## [SPEC-DOD] Dod
SP009 is specification-ready because identity/scope, atomic requirements, primary evidence, decisions, dependencies, tests and UAT are materialized. It is not implementation/product ready.

## [SPEC-OPEN-DECISIONS] Open Decisions
No freeze-blocking identity/scope decision remains; implementation-specific choices remain governed by existing ADR/change control.
