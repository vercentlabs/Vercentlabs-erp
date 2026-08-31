# SP021 — Custom fields, tags and controlled extensibility

Working status: `SPECIFICATION_READY`  
Implementation status: `NOT_STARTED`  
Product status: `NOT_READY`

## [SPEC-IDENTITY] Identity
- Shared-platform ID: `SP021`
- Category: **Configuration & extensibility**
- Owner: **Platform**
- Priority: **P1**
- Canonical business count impact: **NONE**.

## [SPEC-INTENT] Intent
Allow tenant-defined metadata, tags and constrained extensions without bypassing validation, permissions, reporting or upgrade safety.

## [SPEC-OUTCOMES] Outcomes
One governed reusable implementation serves all applicable modules; Custom fields, tags and controlled extensibility remains consistent across web, API, worker and mobile.

## [SPEC-PERSONAS] Personas
Tenant administrators, ERP users, managers/approvers, security/operations personnel, integration clients and implementation agents as applicable; negative-permission personas are mandatory.

## [SPEC-ENTRY-POINTS] Entry Points
Administration/settings where configured and protected runtime/API/mobile/worker paths where Custom fields, tags and controlled extensibility is consumed.

## [SPEC-BENCHMARK] Benchmark
Evidence IDs: `SP021-SRC-SP-OWASP-API`, `SP021-SRC-SP-NIST-SSDF`.

## [SPEC-DECISION] Decision
`DEC-SP021` freezes this exact shared-platform identity and scope.

## [SPEC-OMISSION-GATE] Omission Gate
Red-team Custom fields, tags and controlled extensibility for lifecycle, authorization, multi-company/tenant scope, stale state, concurrency, retry, recovery, reporting, mobile, accessibility, observability and operations.

## [SPEC-SUBCAPABILITIES] Subcapabilities
Requirement families: `SP021-CAP-###`, `SP021-FR-###`, `SP021-US-###`, `SP021-FLOW-###`, `SP021-BR-###`, `SP021-DATA-###`, `SP021-VAL-###`, `SP021-CALC-###`, `SP021-UX-###`, `SP021-SEC-###`, `SP021-AUTO-###`, `SP021-APP-###`, `SP021-NOTIF-###`, `SP021-REP-###`, `SP021-AI-###`, `SP021-INT-###`, `SP021-API-###`, `SP021-PERF-###`, `SP021-OBS-###`, `SP021-E2E-###`, `SP021-UAT-###`.

## [SPEC-FUNCTIONAL] Functional
Approved FRs: `SP021-FR-001`, `SP021-FR-002`, `SP021-FR-003`.

## [SPEC-FLOWS] Flows
Admin defines field/tag -> validates schema -> deploys metadata -> users edit/view -> search/report/import/export -> retire with compatibility.

## [SPEC-STATE-MACHINE] State Machine
Lifecycle/request/job states for Custom fields, tags and controlled extensibility must be explicit; invalid transitions fail before side effects and recovery/reopen is auditable.

## [SPEC-DATA] Data
Data owned by Custom fields, tags and controlled extensibility is tenant/company scoped where applicable, typed, version/effective-dated when policy changes, and classified for retention/security.

## [SPEC-VALIDATION] Validation
Validate identity/scope, lifecycle, schema, references, stale versions, duplicates and policy before mutation.

## [SPEC-BUSINESS-RULES] Business Rules
- Custom data remains tenant-scoped and typed.
- Custom fields obey record/field permissions and audit rules.
- Extensions cannot inject arbitrary server code or SQL.

## [SPEC-CALCULATIONS] Calculations
Any quotas/windows/usage/retry/timestamp-derived values in Custom fields, tags and controlled extensibility use explicit deterministic precision/timezone rules.

## [SPEC-VIEWS] Views
Provide only justified admin/operator views for Custom fields, tags and controlled extensibility using Experience Kernel states.

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
Dependencies: SP009,SP020.

## [SPEC-AUTOMATION] Automation
Automation consumes Custom fields, tags and controlled extensibility only through normal public commands/authorization.

## [SPEC-APPROVALS] Approvals
Use centralized approval/SoD when changing Custom fields, tags and controlled extensibility materially affects security, money, access, data exposure or production operations.

## [SPEC-NOTIFICATIONS] Notifications
Notify responsible actors for actionable Custom fields, tags and controlled extensibility failures, approvals, expirations or security events.

## [SPEC-DOCUMENTS] Documents
Documents/attachments used by Custom fields, tags and controlled extensibility obey SP019 file security, scope, version and retention.

## [SPEC-IMPORT-EXPORT] Import Export
Import/export of Custom fields, tags and controlled extensibility configuration/evidence is permission-scoped, validated and auditable.

## [SPEC-REPORTING] Reporting
Report health, usage, exceptions, audit and policy state for Custom fields, tags and controlled extensibility, including source/freshness.

## [SPEC-AI] Ai
AI may assist/explain Custom fields, tags and controlled extensibility only from authorized context and cannot bypass deterministic controls.

## [SPEC-SECURITY] Security
Schema abuse, field-level data leakage, unbounded metadata growth and unsafe expression execution are primary threats. Security-negative and abuse tests are mandatory.

## [SPEC-SCOPE] Scope
Resolve organization, entitlement, company, branch/site/team/record/field context as applicable; jobs/integrations use trusted persisted scope.

## [SPEC-AUDIT] Audit
Sensitive/high-impact Custom fields, tags and controlled extensibility changes produce durable actor/tenant/target/correlation evidence with secret/PII minimization.

## [SPEC-CONCURRENCY] Concurrency
Identify races in Custom fields, tags and controlled extensibility; enforce DB constraints/locks/version checks or another documented safe mechanism.

## [SPEC-IDEMPOTENCY] Idempotency
Retries in Custom fields, tags and controlled extensibility are classified; unsafe duplicate effects use stable idempotency/business keys and reconciliation.

## [SPEC-INTEGRATIONS] Integrations
Integration contracts involving Custom fields, tags and controlled extensibility are versioned, tenant-scoped, observable and replay-safe.

## [SPEC-API] Api
APIs use authenticated/versioned contracts, object/function/property authorization, bounded resource use and typed errors.

## [SPEC-MOBILE] Mobile
Classify Custom fields, tags and controlled extensibility as full, field-optimized, approval-only, read-only or not-applicable; offline state is bounded/encrypted and revalidated.

## [SPEC-RESPONSIVE] Responsive
Desktop/tablet/phone behavior follows the Experience Kernel and preserves critical actions.

## [SPEC-ACCESSIBILITY] Accessibility
WCAG 2.2 AA intent: keyboard/focus, labels, screen-reader status/errors, contrast, target size, zoom/reflow, reduced motion and non-drag alternatives.

## [SPEC-VISUAL-EVIDENCE] Visual Evidence
Complex Custom fields, tags and controlled extensibility admin/operator surfaces require wireframes/state diagrams before implementation.

## [SPEC-PERFORMANCE] Performance
Define latency/throughput/cardinality/volume budgets for Custom fields, tags and controlled extensibility; use batching/pagination/async/read models where appropriate.

## [SPEC-OBSERVABILITY] Observability
Structured logs/metrics/traces with correlation, diagnostics, alerts and reconciliation support are required for Custom fields, tags and controlled extensibility.

## [SPEC-EDGE-CASES] Edge Cases
Cover duplicates, stale references, concurrency, permission changes, partial failures, retries, outages, timezones/localization and recovery.

## [SPEC-CODE-AUDIT] Code Audit
Before implementation, map current repository paths/symbols to SP021 and classify VERIFIED/PARTIAL/MISSING; code never lowers target requirements.

## [SPEC-GAPS] Gaps
Target minus verified behavior is the implementation gap; framework existence alone is not proof that Custom fields, tags and controlled extensibility is complete.

## [SPEC-IMPLEMENTATION] Implementation
Implement in existing core/packages/worker/database/mobile/shared areas as appropriate; business modules consume public contracts. Pass A changes docs only.

## [SPEC-TESTS] Tests
Unit/domain, DB/RLS, API, security-negative, integration, idempotency/retry, performance, migration and reconciliation tests are planned.

## [SPEC-E2E] E2E
`SP021-TEST-E2E-01` happy path and `SP021-TEST-E2E-02` negative/recovery path are planned.

## [SPEC-UAT] Uat
`SP021-UAT-01` and `SP021-UAT-02` cover primary and failure/permission/recovery validation.

## [SPEC-DOD] Dod
SP021 is specification-ready because identity/scope, atomic requirements, primary evidence, decisions, dependencies, tests and UAT are materialized. It is not implementation/product ready.

## [SPEC-OPEN-DECISIONS] Open Decisions
No freeze-blocking identity/scope decision remains; implementation-specific choices remain governed by existing ADR/change control.
