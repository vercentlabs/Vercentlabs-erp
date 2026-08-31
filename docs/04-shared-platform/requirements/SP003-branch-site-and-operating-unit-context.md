# SP003 — Branch, site and operating-unit context

Working status: `SPECIFICATION_READY`  
Implementation status: `NOT_STARTED`  
Product status: `NOT_READY`

## [SPEC-IDENTITY] Identity
- Shared-platform ID: `SP003`
- Category: **Identity & tenancy**
- Owner: **Platform**
- Priority: **P0**
- Canonical business count impact: **NONE**.

## [SPEC-INTENT] Intent
Represent branches/sites/operating units and provide authoritative contextual scope for business modules without duplicating module-specific warehouse/plant/project entities.

## [SPEC-OUTCOMES] Outcomes
One governed reusable implementation serves all applicable modules; Branch, site and operating-unit context remains consistent across web, API, worker and mobile.

## [SPEC-PERSONAS] Personas
Tenant administrators, ERP users, managers/approvers, security/operations personnel, integration clients and implementation agents as applicable; negative-permission personas are mandatory.

## [SPEC-ENTRY-POINTS] Entry Points
Administration/settings where configured and protected runtime/API/mobile/worker paths where Branch, site and operating-unit context is consumed.

## [SPEC-BENCHMARK] Benchmark
Evidence IDs: `SP003-SRC-SP-PG-RLS`, `SP003-SRC-SP-OWASP-API`.

## [SPEC-DECISION] Decision
`DEC-SP003` freezes this exact shared-platform identity and scope.

## [SPEC-OMISSION-GATE] Omission Gate
Red-team Branch, site and operating-unit context for lifecycle, authorization, multi-company/tenant scope, stale state, concurrency, retry, recovery, reporting, mobile, accessibility, observability and operations.

## [SPEC-SUBCAPABILITIES] Subcapabilities
Requirement families: `SP003-CAP-###`, `SP003-FR-###`, `SP003-US-###`, `SP003-FLOW-###`, `SP003-BR-###`, `SP003-DATA-###`, `SP003-VAL-###`, `SP003-CALC-###`, `SP003-UX-###`, `SP003-SEC-###`, `SP003-AUTO-###`, `SP003-APP-###`, `SP003-NOTIF-###`, `SP003-REP-###`, `SP003-AI-###`, `SP003-INT-###`, `SP003-API-###`, `SP003-PERF-###`, `SP003-OBS-###`, `SP003-E2E-###`, `SP003-UAT-###`.

## [SPEC-FUNCTIONAL] Functional
Approved FRs: `SP003-FR-001`, `SP003-FR-002`, `SP003-FR-003`.

## [SPEC-FLOWS] Flows
Admin configures branch/site; user obtains allowed scopes; module commands validate active context and record scope.

## [SPEC-STATE-MACHINE] State Machine
Lifecycle/request/job states for Branch, site and operating-unit context must be explicit; invalid transitions fail before side effects and recovery/reopen is auditable.

## [SPEC-DATA] Data
Data owned by Branch, site and operating-unit context is tenant/company scoped where applicable, typed, version/effective-dated when policy changes, and classified for retention/security.

## [SPEC-VALIDATION] Validation
Validate identity/scope, lifecycle, schema, references, stale versions, duplicates and policy before mutation.

## [SPEC-BUSINESS-RULES] Business Rules
- Branch/site scope is server-authoritative.
- Inactive scope cannot receive new business writes unless an approved historical correction path exists.
- Scope inheritance is explicit and testable.

## [SPEC-CALCULATIONS] Calculations
Any quotas/windows/usage/retry/timestamp-derived values in Branch, site and operating-unit context use explicit deterministic precision/timezone rules.

## [SPEC-VIEWS] Views
Provide only justified admin/operator views for Branch, site and operating-unit context using Experience Kernel states.

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
Dependencies: SP001,SP002.

## [SPEC-AUTOMATION] Automation
Automation consumes Branch, site and operating-unit context only through normal public commands/authorization.

## [SPEC-APPROVALS] Approvals
Use centralized approval/SoD when changing Branch, site and operating-unit context materially affects security, money, access, data exposure or production operations.

## [SPEC-NOTIFICATIONS] Notifications
Notify responsible actors for actionable Branch, site and operating-unit context failures, approvals, expirations or security events.

## [SPEC-DOCUMENTS] Documents
Documents/attachments used by Branch, site and operating-unit context obey SP019 file security, scope, version and retention.

## [SPEC-IMPORT-EXPORT] Import Export
Import/export of Branch, site and operating-unit context configuration/evidence is permission-scoped, validated and auditable.

## [SPEC-REPORTING] Reporting
Report health, usage, exceptions, audit and policy state for Branch, site and operating-unit context, including source/freshness.

## [SPEC-AI] Ai
AI may assist/explain Branch, site and operating-unit context only from authorized context and cannot bypass deterministic controls.

## [SPEC-SECURITY] Security
Branch-switch IDOR, stale membership, and scope confusion between branch/site/warehouse/plant are primary threats. Security-negative and abuse tests are mandatory.

## [SPEC-SCOPE] Scope
Resolve organization, entitlement, company, branch/site/team/record/field context as applicable; jobs/integrations use trusted persisted scope.

## [SPEC-AUDIT] Audit
Sensitive/high-impact Branch, site and operating-unit context changes produce durable actor/tenant/target/correlation evidence with secret/PII minimization.

## [SPEC-CONCURRENCY] Concurrency
Identify races in Branch, site and operating-unit context; enforce DB constraints/locks/version checks or another documented safe mechanism.

## [SPEC-IDEMPOTENCY] Idempotency
Retries in Branch, site and operating-unit context are classified; unsafe duplicate effects use stable idempotency/business keys and reconciliation.

## [SPEC-INTEGRATIONS] Integrations
Integration contracts involving Branch, site and operating-unit context are versioned, tenant-scoped, observable and replay-safe.

## [SPEC-API] Api
APIs use authenticated/versioned contracts, object/function/property authorization, bounded resource use and typed errors.

## [SPEC-MOBILE] Mobile
Classify Branch, site and operating-unit context as full, field-optimized, approval-only, read-only or not-applicable; offline state is bounded/encrypted and revalidated.

## [SPEC-RESPONSIVE] Responsive
Desktop/tablet/phone behavior follows the Experience Kernel and preserves critical actions.

## [SPEC-ACCESSIBILITY] Accessibility
WCAG 2.2 AA intent: keyboard/focus, labels, screen-reader status/errors, contrast, target size, zoom/reflow, reduced motion and non-drag alternatives.

## [SPEC-VISUAL-EVIDENCE] Visual Evidence
Complex Branch, site and operating-unit context admin/operator surfaces require wireframes/state diagrams before implementation.

## [SPEC-PERFORMANCE] Performance
Define latency/throughput/cardinality/volume budgets for Branch, site and operating-unit context; use batching/pagination/async/read models where appropriate.

## [SPEC-OBSERVABILITY] Observability
Structured logs/metrics/traces with correlation, diagnostics, alerts and reconciliation support are required for Branch, site and operating-unit context.

## [SPEC-EDGE-CASES] Edge Cases
Cover duplicates, stale references, concurrency, permission changes, partial failures, retries, outages, timezones/localization and recovery.

## [SPEC-CODE-AUDIT] Code Audit
Before implementation, map current repository paths/symbols to SP003 and classify VERIFIED/PARTIAL/MISSING; code never lowers target requirements.

## [SPEC-GAPS] Gaps
Target minus verified behavior is the implementation gap; framework existence alone is not proof that Branch, site and operating-unit context is complete.

## [SPEC-IMPLEMENTATION] Implementation
Implement in existing core/packages/worker/database/mobile/shared areas as appropriate; business modules consume public contracts. Pass A changes docs only.

## [SPEC-TESTS] Tests
Unit/domain, DB/RLS, API, security-negative, integration, idempotency/retry, performance, migration and reconciliation tests are planned.

## [SPEC-E2E] E2E
`SP003-TEST-E2E-01` happy path and `SP003-TEST-E2E-02` negative/recovery path are planned.

## [SPEC-UAT] Uat
`SP003-UAT-01` and `SP003-UAT-02` cover primary and failure/permission/recovery validation.

## [SPEC-DOD] Dod
SP003 is specification-ready because identity/scope, atomic requirements, primary evidence, decisions, dependencies, tests and UAT are materialized. It is not implementation/product ready.

## [SPEC-OPEN-DECISIONS] Open Decisions
No freeze-blocking identity/scope decision remains; implementation-specific choices remain governed by existing ADR/change control.
