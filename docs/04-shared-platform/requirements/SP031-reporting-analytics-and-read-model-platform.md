# SP031 — Reporting, analytics and read-model platform

Working status: `SPECIFICATION_READY`  
Implementation status: `NOT_STARTED`  
Product status: `NOT_READY`

## [SPEC-IDENTITY] Identity
- Shared-platform ID: `SP031`
- Category: **Data access**
- Owner: **Platform**
- Priority: **P1**
- Canonical business count impact: **NONE**.

## [SPEC-INTENT] Intent
Provide reusable reporting/read-model infrastructure, filtering, scheduled exports and governed aggregation without bypassing row/field permissions or authoritative source reconciliation.

## [SPEC-OUTCOMES] Outcomes
One governed reusable implementation serves all applicable modules; Reporting, analytics and read-model platform remains consistent across web, API, worker and mobile.

## [SPEC-PERSONAS] Personas
Tenant administrators, ERP users, managers/approvers, security/operations personnel, integration clients and implementation agents as applicable; negative-permission personas are mandatory.

## [SPEC-ENTRY-POINTS] Entry Points
Administration/settings where configured and protected runtime/API/mobile/worker paths where Reporting, analytics and read-model platform is consumed.

## [SPEC-BENCHMARK] Benchmark
Evidence IDs: `SP031-SRC-SP-OWASP-API`, `SP031-SRC-SP-OTEL`.

## [SPEC-DECISION] Decision
`DEC-SP031` freezes this exact shared-platform identity and scope.

## [SPEC-OMISSION-GATE] Omission Gate
Red-team Reporting, analytics and read-model platform for lifecycle, authorization, multi-company/tenant scope, stale state, concurrency, retry, recovery, reporting, mobile, accessibility, observability and operations.

## [SPEC-SUBCAPABILITIES] Subcapabilities
Requirement families: `SP031-CAP-###`, `SP031-FR-###`, `SP031-US-###`, `SP031-FLOW-###`, `SP031-BR-###`, `SP031-DATA-###`, `SP031-VAL-###`, `SP031-CALC-###`, `SP031-UX-###`, `SP031-SEC-###`, `SP031-AUTO-###`, `SP031-APP-###`, `SP031-NOTIF-###`, `SP031-REP-###`, `SP031-AI-###`, `SP031-INT-###`, `SP031-API-###`, `SP031-PERF-###`, `SP031-OBS-###`, `SP031-E2E-###`, `SP031-UAT-###`.

## [SPEC-FUNCTIONAL] Functional
Approved FRs: `SP031-FR-001`, `SP031-FR-002`, `SP031-FR-003`.

## [SPEC-FLOWS] Flows
Select report -> scope/filter -> query read model -> drill to source -> export/schedule -> reconcile freshness/authority.

## [SPEC-STATE-MACHINE] State Machine
Lifecycle/request/job states for Reporting, analytics and read-model platform must be explicit; invalid transitions fail before side effects and recovery/reopen is auditable.

## [SPEC-DATA] Data
Data owned by Reporting, analytics and read-model platform is tenant/company scoped where applicable, typed, version/effective-dated when policy changes, and classified for retention/security.

## [SPEC-VALIDATION] Validation
Validate identity/scope, lifecycle, schema, references, stale versions, duplicates and policy before mutation.

## [SPEC-BUSINESS-RULES] Business Rules
- Reports are derived views, not alternate systems of record.
- Row/field authorization applies to report data.
- Financial/stock/payroll reports reconcile to authoritative ledgers/snapshots.

## [SPEC-CALCULATIONS] Calculations
Any quotas/windows/usage/retry/timestamp-derived values in Reporting, analytics and read-model platform use explicit deterministic precision/timezone rules.

## [SPEC-VIEWS] Views
Provide only justified admin/operator views for Reporting, analytics and read-model platform using Experience Kernel states.

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
Dependencies: SP009,SP016,SP020.

## [SPEC-AUTOMATION] Automation
Automation consumes Reporting, analytics and read-model platform only through normal public commands/authorization.

## [SPEC-APPROVALS] Approvals
Use centralized approval/SoD when changing Reporting, analytics and read-model platform materially affects security, money, access, data exposure or production operations.

## [SPEC-NOTIFICATIONS] Notifications
Notify responsible actors for actionable Reporting, analytics and read-model platform failures, approvals, expirations or security events.

## [SPEC-DOCUMENTS] Documents
Documents/attachments used by Reporting, analytics and read-model platform obey SP019 file security, scope, version and retention.

## [SPEC-IMPORT-EXPORT] Import Export
Import/export of Reporting, analytics and read-model platform configuration/evidence is permission-scoped, validated and auditable.

## [SPEC-REPORTING] Reporting
Report health, usage, exceptions, audit and policy state for Reporting, analytics and read-model platform, including source/freshness.

## [SPEC-AI] Ai
AI may assist/explain Reporting, analytics and read-model platform only from authorized context and cannot bypass deterministic controls.

## [SPEC-SECURITY] Security
Aggregated data leakage, stale read models, expensive queries and report-vs-source disagreement are primary threats. Security-negative and abuse tests are mandatory.

## [SPEC-SCOPE] Scope
Resolve organization, entitlement, company, branch/site/team/record/field context as applicable; jobs/integrations use trusted persisted scope.

## [SPEC-AUDIT] Audit
Sensitive/high-impact Reporting, analytics and read-model platform changes produce durable actor/tenant/target/correlation evidence with secret/PII minimization.

## [SPEC-CONCURRENCY] Concurrency
Identify races in Reporting, analytics and read-model platform; enforce DB constraints/locks/version checks or another documented safe mechanism.

## [SPEC-IDEMPOTENCY] Idempotency
Retries in Reporting, analytics and read-model platform are classified; unsafe duplicate effects use stable idempotency/business keys and reconciliation.

## [SPEC-INTEGRATIONS] Integrations
Integration contracts involving Reporting, analytics and read-model platform are versioned, tenant-scoped, observable and replay-safe.

## [SPEC-API] Api
APIs use authenticated/versioned contracts, object/function/property authorization, bounded resource use and typed errors.

## [SPEC-MOBILE] Mobile
Classify Reporting, analytics and read-model platform as full, field-optimized, approval-only, read-only or not-applicable; offline state is bounded/encrypted and revalidated.

## [SPEC-RESPONSIVE] Responsive
Desktop/tablet/phone behavior follows the Experience Kernel and preserves critical actions.

## [SPEC-ACCESSIBILITY] Accessibility
WCAG 2.2 AA intent: keyboard/focus, labels, screen-reader status/errors, contrast, target size, zoom/reflow, reduced motion and non-drag alternatives.

## [SPEC-VISUAL-EVIDENCE] Visual Evidence
Complex Reporting, analytics and read-model platform admin/operator surfaces require wireframes/state diagrams before implementation.

## [SPEC-PERFORMANCE] Performance
Define latency/throughput/cardinality/volume budgets for Reporting, analytics and read-model platform; use batching/pagination/async/read models where appropriate.

## [SPEC-OBSERVABILITY] Observability
Structured logs/metrics/traces with correlation, diagnostics, alerts and reconciliation support are required for Reporting, analytics and read-model platform.

## [SPEC-EDGE-CASES] Edge Cases
Cover duplicates, stale references, concurrency, permission changes, partial failures, retries, outages, timezones/localization and recovery.

## [SPEC-CODE-AUDIT] Code Audit
Before implementation, map current repository paths/symbols to SP031 and classify VERIFIED/PARTIAL/MISSING; code never lowers target requirements.

## [SPEC-GAPS] Gaps
Target minus verified behavior is the implementation gap; framework existence alone is not proof that Reporting, analytics and read-model platform is complete.

## [SPEC-IMPLEMENTATION] Implementation
Implement in existing core/packages/worker/database/mobile/shared areas as appropriate; business modules consume public contracts. Pass A changes docs only.

## [SPEC-TESTS] Tests
Unit/domain, DB/RLS, API, security-negative, integration, idempotency/retry, performance, migration and reconciliation tests are planned.

## [SPEC-E2E] E2E
`SP031-TEST-E2E-01` happy path and `SP031-TEST-E2E-02` negative/recovery path are planned.

## [SPEC-UAT] Uat
`SP031-UAT-01` and `SP031-UAT-02` cover primary and failure/permission/recovery validation.

## [SPEC-DOD] Dod
SP031 is specification-ready because identity/scope, atomic requirements, primary evidence, decisions, dependencies, tests and UAT are materialized. It is not implementation/product ready.

## [SPEC-OPEN-DECISIONS] Open Decisions
No freeze-blocking identity/scope decision remains; implementation-specific choices remain governed by existing ADR/change control.
