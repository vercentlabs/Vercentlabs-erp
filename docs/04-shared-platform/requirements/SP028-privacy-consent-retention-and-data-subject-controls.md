# SP028 — Privacy, consent, retention and data-subject controls

Working status: `SPECIFICATION_READY`  
Implementation status: `NOT_STARTED`  
Product status: `NOT_READY`

## [SPEC-IDENTITY] Identity
- Shared-platform ID: `SP028`
- Category: **Governance & evidence**
- Owner: **Security**
- Priority: **P0**
- Canonical business count impact: **NONE**.

## [SPEC-INTENT] Intent
Classify personal data, minimize collection, record applicable consent/notice basis, enforce retention/legal holds and support governed access/export/correction/deletion workflows subject to business/legal obligations.

## [SPEC-OUTCOMES] Outcomes
One governed reusable implementation serves all applicable modules; Privacy, consent, retention and data-subject controls remains consistent across web, API, worker and mobile.

## [SPEC-PERSONAS] Personas
Tenant administrators, ERP users, managers/approvers, security/operations personnel, integration clients and implementation agents as applicable; negative-permission personas are mandatory.

## [SPEC-ENTRY-POINTS] Entry Points
Administration/settings where configured and protected runtime/API/mobile/worker paths where Privacy, consent, retention and data-subject controls is consumed.

## [SPEC-BENCHMARK] Benchmark
Evidence IDs: `SP028-SRC-SP-MEITY-DPDP`, `SP028-SRC-SP-NIST-63-4`, `SP028-SRC-SP-OWASP-API`.

## [SPEC-DECISION] Decision
`DEC-SP028` freezes this exact shared-platform identity and scope.

## [SPEC-OMISSION-GATE] Omission Gate
Red-team Privacy, consent, retention and data-subject controls for lifecycle, authorization, multi-company/tenant scope, stale state, concurrency, retry, recovery, reporting, mobile, accessibility, observability and operations.

## [SPEC-SUBCAPABILITIES] Subcapabilities
Requirement families: `SP028-CAP-###`, `SP028-FR-###`, `SP028-US-###`, `SP028-FLOW-###`, `SP028-BR-###`, `SP028-DATA-###`, `SP028-VAL-###`, `SP028-CALC-###`, `SP028-UX-###`, `SP028-SEC-###`, `SP028-AUTO-###`, `SP028-APP-###`, `SP028-NOTIF-###`, `SP028-REP-###`, `SP028-AI-###`, `SP028-INT-###`, `SP028-API-###`, `SP028-PERF-###`, `SP028-OBS-###`, `SP028-E2E-###`, `SP028-UAT-###`.

## [SPEC-FUNCTIONAL] Functional
Approved FRs: `SP028-FR-001`, `SP028-FR-002`, `SP028-FR-003`.

## [SPEC-FLOWS] Flows
Classify/collect -> notice/consent where applicable -> use/access -> retention/hold -> request intake -> verify -> export/correct/delete/restrict -> audit.

## [SPEC-STATE-MACHINE] State Machine
Lifecycle/request/job states for Privacy, consent, retention and data-subject controls must be explicit; invalid transitions fail before side effects and recovery/reopen is auditable.

## [SPEC-DATA] Data
Data owned by Privacy, consent, retention and data-subject controls is tenant/company scoped where applicable, typed, version/effective-dated when policy changes, and classified for retention/security.

## [SPEC-VALIDATION] Validation
Validate identity/scope, lifecycle, schema, references, stale versions, duplicates and policy before mutation.

## [SPEC-BUSINESS-RULES] Business Rules
- Deletion requests never corrupt statutory/audit/financial retention obligations.
- Exports are identity-verified and tenant-scoped.
- Retention rules are effective-dated/configurable and evidence-backed.

## [SPEC-CALCULATIONS] Calculations
Any quotas/windows/usage/retry/timestamp-derived values in Privacy, consent, retention and data-subject controls use explicit deterministic precision/timezone rules.

## [SPEC-VIEWS] Views
Provide only justified admin/operator views for Privacy, consent, retention and data-subject controls using Experience Kernel states.

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
Dependencies: SP009,SP014,SP019,SP026.

## [SPEC-AUTOMATION] Automation
Automation consumes Privacy, consent, retention and data-subject controls only through normal public commands/authorization.

## [SPEC-APPROVALS] Approvals
Use centralized approval/SoD when changing Privacy, consent, retention and data-subject controls materially affects security, money, access, data exposure or production operations.

## [SPEC-NOTIFICATIONS] Notifications
Notify responsible actors for actionable Privacy, consent, retention and data-subject controls failures, approvals, expirations or security events.

## [SPEC-DOCUMENTS] Documents
Documents/attachments used by Privacy, consent, retention and data-subject controls obey SP019 file security, scope, version and retention.

## [SPEC-IMPORT-EXPORT] Import Export
Import/export of Privacy, consent, retention and data-subject controls configuration/evidence is permission-scoped, validated and auditable.

## [SPEC-REPORTING] Reporting
Report health, usage, exceptions, audit and policy state for Privacy, consent, retention and data-subject controls, including source/freshness.

## [SPEC-AI] Ai
AI may assist/explain Privacy, consent, retention and data-subject controls only from authorized context and cannot bypass deterministic controls.

## [SPEC-SECURITY] Security
PII overexposure, unauthorized subject export, premature deletion and indefinite retention are primary threats. Security-negative and abuse tests are mandatory.

## [SPEC-SCOPE] Scope
Resolve organization, entitlement, company, branch/site/team/record/field context as applicable; jobs/integrations use trusted persisted scope.

## [SPEC-AUDIT] Audit
Sensitive/high-impact Privacy, consent, retention and data-subject controls changes produce durable actor/tenant/target/correlation evidence with secret/PII minimization.

## [SPEC-CONCURRENCY] Concurrency
Identify races in Privacy, consent, retention and data-subject controls; enforce DB constraints/locks/version checks or another documented safe mechanism.

## [SPEC-IDEMPOTENCY] Idempotency
Retries in Privacy, consent, retention and data-subject controls are classified; unsafe duplicate effects use stable idempotency/business keys and reconciliation.

## [SPEC-INTEGRATIONS] Integrations
Integration contracts involving Privacy, consent, retention and data-subject controls are versioned, tenant-scoped, observable and replay-safe.

## [SPEC-API] Api
APIs use authenticated/versioned contracts, object/function/property authorization, bounded resource use and typed errors.

## [SPEC-MOBILE] Mobile
Classify Privacy, consent, retention and data-subject controls as full, field-optimized, approval-only, read-only or not-applicable; offline state is bounded/encrypted and revalidated.

## [SPEC-RESPONSIVE] Responsive
Desktop/tablet/phone behavior follows the Experience Kernel and preserves critical actions.

## [SPEC-ACCESSIBILITY] Accessibility
WCAG 2.2 AA intent: keyboard/focus, labels, screen-reader status/errors, contrast, target size, zoom/reflow, reduced motion and non-drag alternatives.

## [SPEC-VISUAL-EVIDENCE] Visual Evidence
Complex Privacy, consent, retention and data-subject controls admin/operator surfaces require wireframes/state diagrams before implementation.

## [SPEC-PERFORMANCE] Performance
Define latency/throughput/cardinality/volume budgets for Privacy, consent, retention and data-subject controls; use batching/pagination/async/read models where appropriate.

## [SPEC-OBSERVABILITY] Observability
Structured logs/metrics/traces with correlation, diagnostics, alerts and reconciliation support are required for Privacy, consent, retention and data-subject controls.

## [SPEC-EDGE-CASES] Edge Cases
Cover duplicates, stale references, concurrency, permission changes, partial failures, retries, outages, timezones/localization and recovery.

## [SPEC-CODE-AUDIT] Code Audit
Before implementation, map current repository paths/symbols to SP028 and classify VERIFIED/PARTIAL/MISSING; code never lowers target requirements.

## [SPEC-GAPS] Gaps
Target minus verified behavior is the implementation gap; framework existence alone is not proof that Privacy, consent, retention and data-subject controls is complete.

## [SPEC-IMPLEMENTATION] Implementation
Implement in existing core/packages/worker/database/mobile/shared areas as appropriate; business modules consume public contracts. Pass A changes docs only.

## [SPEC-TESTS] Tests
Unit/domain, DB/RLS, API, security-negative, integration, idempotency/retry, performance, migration and reconciliation tests are planned.

## [SPEC-E2E] E2E
`SP028-TEST-E2E-01` happy path and `SP028-TEST-E2E-02` negative/recovery path are planned.

## [SPEC-UAT] Uat
`SP028-UAT-01` and `SP028-UAT-02` cover primary and failure/permission/recovery validation.

## [SPEC-DOD] Dod
SP028 is specification-ready because identity/scope, atomic requirements, primary evidence, decisions, dependencies, tests and UAT are materialized. It is not implementation/product ready.

## [SPEC-OPEN-DECISIONS] Open Decisions
No freeze-blocking identity/scope decision remains; implementation-specific choices remain governed by existing ADR/change control.
