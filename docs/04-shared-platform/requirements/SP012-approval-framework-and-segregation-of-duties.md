# SP012 — Approval framework and segregation of duties

Working status: `SPECIFICATION_READY`  
Implementation status: `NOT_STARTED`  
Product status: `NOT_READY`

## [SPEC-IDENTITY] Identity
- Shared-platform ID: `SP012`
- Category: **Workflow & control**
- Owner: **Platform**
- Priority: **P0**
- Canonical business count impact: **NONE**.

## [SPEC-INTENT] Intent
Provide reusable maker-checker approvals, delegation, thresholds, escalation and separation-of-duties controls without replacing module-owned business invariants.

## [SPEC-OUTCOMES] Outcomes
One governed reusable implementation serves all applicable modules; Approval framework and segregation of duties remains consistent across web, API, worker and mobile.

## [SPEC-PERSONAS] Personas
Tenant administrators, ERP users, managers/approvers, security/operations personnel, integration clients and implementation agents as applicable; negative-permission personas are mandatory.

## [SPEC-ENTRY-POINTS] Entry Points
Administration/settings where configured and protected runtime/API/mobile/worker paths where Approval framework and segregation of duties is consumed.

## [SPEC-BENCHMARK] Benchmark
Evidence IDs: `SP012-SRC-SP-OWASP-API`, `SP012-SRC-SP-NIST-SSDF`.

## [SPEC-DECISION] Decision
`DEC-SP012` freezes this exact shared-platform identity and scope.

## [SPEC-OMISSION-GATE] Omission Gate
Red-team Approval framework and segregation of duties for lifecycle, authorization, multi-company/tenant scope, stale state, concurrency, retry, recovery, reporting, mobile, accessibility, observability and operations.

## [SPEC-SUBCAPABILITIES] Subcapabilities
Requirement families: `SP012-CAP-###`, `SP012-FR-###`, `SP012-US-###`, `SP012-FLOW-###`, `SP012-BR-###`, `SP012-DATA-###`, `SP012-VAL-###`, `SP012-CALC-###`, `SP012-UX-###`, `SP012-SEC-###`, `SP012-AUTO-###`, `SP012-APP-###`, `SP012-NOTIF-###`, `SP012-REP-###`, `SP012-AI-###`, `SP012-INT-###`, `SP012-API-###`, `SP012-PERF-###`, `SP012-OBS-###`, `SP012-E2E-###`, `SP012-UAT-###`.

## [SPEC-FUNCTIONAL] Functional
Approved FRs: `SP012-FR-001`, `SP012-FR-002`, `SP012-FR-003`.

## [SPEC-FLOWS] Flows
Submit -> route approvers -> approve/reject/request changes -> escalate/delegate -> execute approved command -> preserve evidence.

## [SPEC-STATE-MACHINE] State Machine
Lifecycle/request/job states for Approval framework and segregation of duties must be explicit; invalid transitions fail before side effects and recovery/reopen is auditable.

## [SPEC-DATA] Data
Data owned by Approval framework and segregation of duties is tenant/company scoped where applicable, typed, version/effective-dated when policy changes, and classified for retention/security.

## [SPEC-VALIDATION] Validation
Validate identity/scope, lifecycle, schema, references, stale versions, duplicates and policy before mutation.

## [SPEC-BUSINESS-RULES] Business Rules
- Self-approval is denied where policy forbids it.
- Approval decision records are immutable/auditable.
- Approval state cannot be bypassed by alternate API paths.

## [SPEC-CALCULATIONS] Calculations
Any quotas/windows/usage/retry/timestamp-derived values in Approval framework and segregation of duties use explicit deterministic precision/timezone rules.

## [SPEC-VIEWS] Views
Provide only justified admin/operator views for Approval framework and segregation of duties using Experience Kernel states.

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
Dependencies: SP008,SP009.

## [SPEC-AUTOMATION] Automation
Automation consumes Approval framework and segregation of duties only through normal public commands/authorization.

## [SPEC-APPROVALS] Approvals
Use centralized approval/SoD when changing Approval framework and segregation of duties materially affects security, money, access, data exposure or production operations.

## [SPEC-NOTIFICATIONS] Notifications
Notify responsible actors for actionable Approval framework and segregation of duties failures, approvals, expirations or security events.

## [SPEC-DOCUMENTS] Documents
Documents/attachments used by Approval framework and segregation of duties obey SP019 file security, scope, version and retention.

## [SPEC-IMPORT-EXPORT] Import Export
Import/export of Approval framework and segregation of duties configuration/evidence is permission-scoped, validated and auditable.

## [SPEC-REPORTING] Reporting
Report health, usage, exceptions, audit and policy state for Approval framework and segregation of duties, including source/freshness.

## [SPEC-AI] Ai
AI may assist/explain Approval framework and segregation of duties only from authorized context and cannot bypass deterministic controls.

## [SPEC-SECURITY] Security
Self-approval, delegated privilege abuse, stale approval after record change and API bypass are primary threats. Security-negative and abuse tests are mandatory.

## [SPEC-SCOPE] Scope
Resolve organization, entitlement, company, branch/site/team/record/field context as applicable; jobs/integrations use trusted persisted scope.

## [SPEC-AUDIT] Audit
Sensitive/high-impact Approval framework and segregation of duties changes produce durable actor/tenant/target/correlation evidence with secret/PII minimization.

## [SPEC-CONCURRENCY] Concurrency
Identify races in Approval framework and segregation of duties; enforce DB constraints/locks/version checks or another documented safe mechanism.

## [SPEC-IDEMPOTENCY] Idempotency
Retries in Approval framework and segregation of duties are classified; unsafe duplicate effects use stable idempotency/business keys and reconciliation.

## [SPEC-INTEGRATIONS] Integrations
Integration contracts involving Approval framework and segregation of duties are versioned, tenant-scoped, observable and replay-safe.

## [SPEC-API] Api
APIs use authenticated/versioned contracts, object/function/property authorization, bounded resource use and typed errors.

## [SPEC-MOBILE] Mobile
Classify Approval framework and segregation of duties as full, field-optimized, approval-only, read-only or not-applicable; offline state is bounded/encrypted and revalidated.

## [SPEC-RESPONSIVE] Responsive
Desktop/tablet/phone behavior follows the Experience Kernel and preserves critical actions.

## [SPEC-ACCESSIBILITY] Accessibility
WCAG 2.2 AA intent: keyboard/focus, labels, screen-reader status/errors, contrast, target size, zoom/reflow, reduced motion and non-drag alternatives.

## [SPEC-VISUAL-EVIDENCE] Visual Evidence
Complex Approval framework and segregation of duties admin/operator surfaces require wireframes/state diagrams before implementation.

## [SPEC-PERFORMANCE] Performance
Define latency/throughput/cardinality/volume budgets for Approval framework and segregation of duties; use batching/pagination/async/read models where appropriate.

## [SPEC-OBSERVABILITY] Observability
Structured logs/metrics/traces with correlation, diagnostics, alerts and reconciliation support are required for Approval framework and segregation of duties.

## [SPEC-EDGE-CASES] Edge Cases
Cover duplicates, stale references, concurrency, permission changes, partial failures, retries, outages, timezones/localization and recovery.

## [SPEC-CODE-AUDIT] Code Audit
Before implementation, map current repository paths/symbols to SP012 and classify VERIFIED/PARTIAL/MISSING; code never lowers target requirements.

## [SPEC-GAPS] Gaps
Target minus verified behavior is the implementation gap; framework existence alone is not proof that Approval framework and segregation of duties is complete.

## [SPEC-IMPLEMENTATION] Implementation
Implement in existing core/packages/worker/database/mobile/shared areas as appropriate; business modules consume public contracts. Pass A changes docs only.

## [SPEC-TESTS] Tests
Unit/domain, DB/RLS, API, security-negative, integration, idempotency/retry, performance, migration and reconciliation tests are planned.

## [SPEC-E2E] E2E
`SP012-TEST-E2E-01` happy path and `SP012-TEST-E2E-02` negative/recovery path are planned.

## [SPEC-UAT] Uat
`SP012-UAT-01` and `SP012-UAT-02` cover primary and failure/permission/recovery validation.

## [SPEC-DOD] Dod
SP012 is specification-ready because identity/scope, atomic requirements, primary evidence, decisions, dependencies, tests and UAT are materialized. It is not implementation/product ready.

## [SPEC-OPEN-DECISIONS] Open Decisions
No freeze-blocking identity/scope decision remains; implementation-specific choices remain governed by existing ADR/change control.
