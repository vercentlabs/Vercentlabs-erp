# SP033 — Experience Kernel, responsive web and cross-device UX

Working status: `SPECIFICATION_READY`  
Implementation status: `NOT_STARTED`  
Product status: `NOT_READY`

## [SPEC-IDENTITY] Identity
- Shared-platform ID: `SP033`
- Category: **Experience**
- Owner: **UX**
- Priority: **P0**
- Canonical business count impact: **NONE**.

## [SPEC-INTENT] Intent
Freeze reusable ERP layout/components/states so all modules share navigation, records, grids, forms, approvals, audit, dashboards and responsive behavior across desktop/tablet/phone.

## [SPEC-OUTCOMES] Outcomes
One governed reusable implementation serves all applicable modules; Experience Kernel, responsive web and cross-device UX remains consistent across web, API, worker and mobile.

## [SPEC-PERSONAS] Personas
Tenant administrators, ERP users, managers/approvers, security/operations personnel, integration clients and implementation agents as applicable; negative-permission personas are mandatory.

## [SPEC-ENTRY-POINTS] Entry Points
Administration/settings where configured and protected runtime/API/mobile/worker paths where Experience Kernel, responsive web and cross-device UX is consumed.

## [SPEC-BENCHMARK] Benchmark
Evidence IDs: `SP033-SRC-SP-WCAG-22`, `SP033-SRC-SP-NIST-SSDF`.

## [SPEC-DECISION] Decision
`DEC-SP033` freezes this exact shared-platform identity and scope.

## [SPEC-OMISSION-GATE] Omission Gate
Red-team Experience Kernel, responsive web and cross-device UX for lifecycle, authorization, multi-company/tenant scope, stale state, concurrency, retry, recovery, reporting, mobile, accessibility, observability and operations.

## [SPEC-SUBCAPABILITIES] Subcapabilities
Requirement families: `SP033-CAP-###`, `SP033-FR-###`, `SP033-US-###`, `SP033-FLOW-###`, `SP033-BR-###`, `SP033-DATA-###`, `SP033-VAL-###`, `SP033-CALC-###`, `SP033-UX-###`, `SP033-SEC-###`, `SP033-AUTO-###`, `SP033-APP-###`, `SP033-NOTIF-###`, `SP033-REP-###`, `SP033-AI-###`, `SP033-INT-###`, `SP033-API-###`, `SP033-PERF-###`, `SP033-OBS-###`, `SP033-E2E-###`, `SP033-UAT-###`.

## [SPEC-FUNCTIONAL] Functional
Approved FRs: `SP033-FR-001`, `SP033-FR-002`, `SP033-FR-003`.

## [SPEC-FLOWS] Flows
Navigate workspace -> list/search -> record 360 -> create/edit/action -> approvals/audit/related records -> responsive adaptation -> error/conflict recovery.

## [SPEC-STATE-MACHINE] State Machine
Lifecycle/request/job states for Experience Kernel, responsive web and cross-device UX must be explicit; invalid transitions fail before side effects and recovery/reopen is auditable.

## [SPEC-DATA] Data
Data owned by Experience Kernel, responsive web and cross-device UX is tenant/company scoped where applicable, typed, version/effective-dated when policy changes, and classified for retention/security.

## [SPEC-VALIDATION] Validation
Validate identity/scope, lifecycle, schema, references, stale versions, duplicates and policy before mutation.

## [SPEC-BUSINESS-RULES] Business Rules
- Reusable UI does not imply generic CRUD; module-specific workflows remain domain-owned.
- Every major surface defines loading/empty/error/forbidden/stale/conflict/offline states.
- Responsive adaptations preserve critical actions or explicitly classify them as mobile-only/not-applicable.

## [SPEC-CALCULATIONS] Calculations
Any quotas/windows/usage/retry/timestamp-derived values in Experience Kernel, responsive web and cross-device UX use explicit deterministic precision/timezone rules.

## [SPEC-VIEWS] Views
Provide only justified admin/operator views for Experience Kernel, responsive web and cross-device UX using Experience Kernel states.

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
Dependencies: SP032.

## [SPEC-AUTOMATION] Automation
Automation consumes Experience Kernel, responsive web and cross-device UX only through normal public commands/authorization.

## [SPEC-APPROVALS] Approvals
Use centralized approval/SoD when changing Experience Kernel, responsive web and cross-device UX materially affects security, money, access, data exposure or production operations.

## [SPEC-NOTIFICATIONS] Notifications
Notify responsible actors for actionable Experience Kernel, responsive web and cross-device UX failures, approvals, expirations or security events.

## [SPEC-DOCUMENTS] Documents
Documents/attachments used by Experience Kernel, responsive web and cross-device UX obey SP019 file security, scope, version and retention.

## [SPEC-IMPORT-EXPORT] Import Export
Import/export of Experience Kernel, responsive web and cross-device UX configuration/evidence is permission-scoped, validated and auditable.

## [SPEC-REPORTING] Reporting
Report health, usage, exceptions, audit and policy state for Experience Kernel, responsive web and cross-device UX, including source/freshness.

## [SPEC-AI] Ai
AI may assist/explain Experience Kernel, responsive web and cross-device UX only from authorized context and cannot bypass deterministic controls.

## [SPEC-SECURITY] Security
Inconsistent module UX, hidden mobile actions, inaccessible dense data and destructive actions without confirmation/recovery are primary risks. Security-negative and abuse tests are mandatory.

## [SPEC-SCOPE] Scope
Resolve organization, entitlement, company, branch/site/team/record/field context as applicable; jobs/integrations use trusted persisted scope.

## [SPEC-AUDIT] Audit
Sensitive/high-impact Experience Kernel, responsive web and cross-device UX changes produce durable actor/tenant/target/correlation evidence with secret/PII minimization.

## [SPEC-CONCURRENCY] Concurrency
Identify races in Experience Kernel, responsive web and cross-device UX; enforce DB constraints/locks/version checks or another documented safe mechanism.

## [SPEC-IDEMPOTENCY] Idempotency
Retries in Experience Kernel, responsive web and cross-device UX are classified; unsafe duplicate effects use stable idempotency/business keys and reconciliation.

## [SPEC-INTEGRATIONS] Integrations
Integration contracts involving Experience Kernel, responsive web and cross-device UX are versioned, tenant-scoped, observable and replay-safe.

## [SPEC-API] Api
APIs use authenticated/versioned contracts, object/function/property authorization, bounded resource use and typed errors.

## [SPEC-MOBILE] Mobile
Classify Experience Kernel, responsive web and cross-device UX as full, field-optimized, approval-only, read-only or not-applicable; offline state is bounded/encrypted and revalidated.

## [SPEC-RESPONSIVE] Responsive
Desktop/tablet/phone behavior follows the Experience Kernel and preserves critical actions.

## [SPEC-ACCESSIBILITY] Accessibility
WCAG 2.2 AA intent: keyboard/focus, labels, screen-reader status/errors, contrast, target size, zoom/reflow, reduced motion and non-drag alternatives.

## [SPEC-VISUAL-EVIDENCE] Visual Evidence
Complex Experience Kernel, responsive web and cross-device UX admin/operator surfaces require wireframes/state diagrams before implementation.

## [SPEC-PERFORMANCE] Performance
Define latency/throughput/cardinality/volume budgets for Experience Kernel, responsive web and cross-device UX; use batching/pagination/async/read models where appropriate.

## [SPEC-OBSERVABILITY] Observability
Structured logs/metrics/traces with correlation, diagnostics, alerts and reconciliation support are required for Experience Kernel, responsive web and cross-device UX.

## [SPEC-EDGE-CASES] Edge Cases
Cover duplicates, stale references, concurrency, permission changes, partial failures, retries, outages, timezones/localization and recovery.

## [SPEC-CODE-AUDIT] Code Audit
Before implementation, map current repository paths/symbols to SP033 and classify VERIFIED/PARTIAL/MISSING; code never lowers target requirements.

## [SPEC-GAPS] Gaps
Target minus verified behavior is the implementation gap; framework existence alone is not proof that Experience Kernel, responsive web and cross-device UX is complete.

## [SPEC-IMPLEMENTATION] Implementation
Implement in existing core/packages/worker/database/mobile/shared areas as appropriate; business modules consume public contracts. Pass A changes docs only.

## [SPEC-TESTS] Tests
Unit/domain, DB/RLS, API, security-negative, integration, idempotency/retry, performance, migration and reconciliation tests are planned.

## [SPEC-E2E] E2E
`SP033-TEST-E2E-01` happy path and `SP033-TEST-E2E-02` negative/recovery path are planned.

## [SPEC-UAT] Uat
`SP033-UAT-01` and `SP033-UAT-02` cover primary and failure/permission/recovery validation.

## [SPEC-DOD] Dod
SP033 is specification-ready because identity/scope, atomic requirements, primary evidence, decisions, dependencies, tests and UAT are materialized. It is not implementation/product ready.

## [SPEC-OPEN-DECISIONS] Open Decisions
No freeze-blocking identity/scope decision remains; implementation-specific choices remain governed by existing ADR/change control.
