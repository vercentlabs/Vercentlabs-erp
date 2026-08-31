# SP007 — MFA, account recovery and step-up authentication

Working status: `SPECIFICATION_READY`  
Implementation status: `NOT_STARTED`  
Product status: `NOT_READY`

## [SPEC-IDENTITY] Identity
- Shared-platform ID: `SP007`
- Category: **Identity & access**
- Owner: **Security**
- Priority: **P0**
- Canonical business count impact: **NONE**.

## [SPEC-INTENT] Intent
Support configurable multi-factor authentication, recovery and high-risk-action step-up without weakening normal authorization.

## [SPEC-OUTCOMES] Outcomes
One governed reusable implementation serves all applicable modules; MFA, account recovery and step-up authentication remains consistent across web, API, worker and mobile.

## [SPEC-PERSONAS] Personas
Tenant administrators, ERP users, managers/approvers, security/operations personnel, integration clients and implementation agents as applicable; negative-permission personas are mandatory.

## [SPEC-ENTRY-POINTS] Entry Points
Administration/settings where configured and protected runtime/API/mobile/worker paths where MFA, account recovery and step-up authentication is consumed.

## [SPEC-BENCHMARK] Benchmark
Evidence IDs: `SP007-SRC-SP-NIST-63B-4`, `SP007-SRC-SP-NIST-63-4`.

## [SPEC-DECISION] Decision
`DEC-SP007` freezes this exact shared-platform identity and scope.

## [SPEC-OMISSION-GATE] Omission Gate
Red-team MFA, account recovery and step-up authentication for lifecycle, authorization, multi-company/tenant scope, stale state, concurrency, retry, recovery, reporting, mobile, accessibility, observability and operations.

## [SPEC-SUBCAPABILITIES] Subcapabilities
Requirement families: `SP007-CAP-###`, `SP007-FR-###`, `SP007-US-###`, `SP007-FLOW-###`, `SP007-BR-###`, `SP007-DATA-###`, `SP007-VAL-###`, `SP007-CALC-###`, `SP007-UX-###`, `SP007-SEC-###`, `SP007-AUTO-###`, `SP007-APP-###`, `SP007-NOTIF-###`, `SP007-REP-###`, `SP007-AI-###`, `SP007-INT-###`, `SP007-API-###`, `SP007-PERF-###`, `SP007-OBS-###`, `SP007-E2E-###`, `SP007-UAT-###`.

## [SPEC-FUNCTIONAL] Functional
Approved FRs: `SP007-FR-001`, `SP007-FR-002`, `SP007-FR-003`.

## [SPEC-FLOWS] Flows
Enroll -> verify -> challenge -> recover backup factor -> rotate/remove -> step-up for sensitive action.

## [SPEC-STATE-MACHINE] State Machine
Lifecycle/request/job states for MFA, account recovery and step-up authentication must be explicit; invalid transitions fail before side effects and recovery/reopen is auditable.

## [SPEC-DATA] Data
Data owned by MFA, account recovery and step-up authentication is tenant/company scoped where applicable, typed, version/effective-dated when policy changes, and classified for retention/security.

## [SPEC-VALIDATION] Validation
Validate identity/scope, lifecycle, schema, references, stale versions, duplicates and policy before mutation.

## [SPEC-BUSINESS-RULES] Business Rules
- Recovery cannot bypass tenant/role authorization.
- MFA enrollment/removal is itself protected by strong verification.
- High-impact actions may require recent authentication independently of login age.

## [SPEC-CALCULATIONS] Calculations
Any quotas/windows/usage/retry/timestamp-derived values in MFA, account recovery and step-up authentication use explicit deterministic precision/timezone rules.

## [SPEC-VIEWS] Views
Provide only justified admin/operator views for MFA, account recovery and step-up authentication using Experience Kernel states.

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
Dependencies: SP005,SP006.

## [SPEC-AUTOMATION] Automation
Automation consumes MFA, account recovery and step-up authentication only through normal public commands/authorization.

## [SPEC-APPROVALS] Approvals
Use centralized approval/SoD when changing MFA, account recovery and step-up authentication materially affects security, money, access, data exposure or production operations.

## [SPEC-NOTIFICATIONS] Notifications
Notify responsible actors for actionable MFA, account recovery and step-up authentication failures, approvals, expirations or security events.

## [SPEC-DOCUMENTS] Documents
Documents/attachments used by MFA, account recovery and step-up authentication obey SP019 file security, scope, version and retention.

## [SPEC-IMPORT-EXPORT] Import Export
Import/export of MFA, account recovery and step-up authentication configuration/evidence is permission-scoped, validated and auditable.

## [SPEC-REPORTING] Reporting
Report health, usage, exceptions, audit and policy state for MFA, account recovery and step-up authentication, including source/freshness.

## [SPEC-AI] Ai
AI may assist/explain MFA, account recovery and step-up authentication only from authorized context and cannot bypass deterministic controls.

## [SPEC-SECURITY] Security
MFA fatigue, recovery-channel takeover, backup-code replay and privileged downgrade are primary threats. Security-negative and abuse tests are mandatory.

## [SPEC-SCOPE] Scope
Resolve organization, entitlement, company, branch/site/team/record/field context as applicable; jobs/integrations use trusted persisted scope.

## [SPEC-AUDIT] Audit
Sensitive/high-impact MFA, account recovery and step-up authentication changes produce durable actor/tenant/target/correlation evidence with secret/PII minimization.

## [SPEC-CONCURRENCY] Concurrency
Identify races in MFA, account recovery and step-up authentication; enforce DB constraints/locks/version checks or another documented safe mechanism.

## [SPEC-IDEMPOTENCY] Idempotency
Retries in MFA, account recovery and step-up authentication are classified; unsafe duplicate effects use stable idempotency/business keys and reconciliation.

## [SPEC-INTEGRATIONS] Integrations
Integration contracts involving MFA, account recovery and step-up authentication are versioned, tenant-scoped, observable and replay-safe.

## [SPEC-API] Api
APIs use authenticated/versioned contracts, object/function/property authorization, bounded resource use and typed errors.

## [SPEC-MOBILE] Mobile
Classify MFA, account recovery and step-up authentication as full, field-optimized, approval-only, read-only or not-applicable; offline state is bounded/encrypted and revalidated.

## [SPEC-RESPONSIVE] Responsive
Desktop/tablet/phone behavior follows the Experience Kernel and preserves critical actions.

## [SPEC-ACCESSIBILITY] Accessibility
WCAG 2.2 AA intent: keyboard/focus, labels, screen-reader status/errors, contrast, target size, zoom/reflow, reduced motion and non-drag alternatives.

## [SPEC-VISUAL-EVIDENCE] Visual Evidence
Complex MFA, account recovery and step-up authentication admin/operator surfaces require wireframes/state diagrams before implementation.

## [SPEC-PERFORMANCE] Performance
Define latency/throughput/cardinality/volume budgets for MFA, account recovery and step-up authentication; use batching/pagination/async/read models where appropriate.

## [SPEC-OBSERVABILITY] Observability
Structured logs/metrics/traces with correlation, diagnostics, alerts and reconciliation support are required for MFA, account recovery and step-up authentication.

## [SPEC-EDGE-CASES] Edge Cases
Cover duplicates, stale references, concurrency, permission changes, partial failures, retries, outages, timezones/localization and recovery.

## [SPEC-CODE-AUDIT] Code Audit
Before implementation, map current repository paths/symbols to SP007 and classify VERIFIED/PARTIAL/MISSING; code never lowers target requirements.

## [SPEC-GAPS] Gaps
Target minus verified behavior is the implementation gap; framework existence alone is not proof that MFA, account recovery and step-up authentication is complete.

## [SPEC-IMPLEMENTATION] Implementation
Implement in existing core/packages/worker/database/mobile/shared areas as appropriate; business modules consume public contracts. Pass A changes docs only.

## [SPEC-TESTS] Tests
Unit/domain, DB/RLS, API, security-negative, integration, idempotency/retry, performance, migration and reconciliation tests are planned.

## [SPEC-E2E] E2E
`SP007-TEST-E2E-01` happy path and `SP007-TEST-E2E-02` negative/recovery path are planned.

## [SPEC-UAT] Uat
`SP007-UAT-01` and `SP007-UAT-02` cover primary and failure/permission/recovery validation.

## [SPEC-DOD] Dod
SP007 is specification-ready because identity/scope, atomic requirements, primary evidence, decisions, dependencies, tests and UAT are materialized. It is not implementation/product ready.

## [SPEC-OPEN-DECISIONS] Open Decisions
No freeze-blocking identity/scope decision remains; implementation-specific choices remain governed by existing ADR/change control.
