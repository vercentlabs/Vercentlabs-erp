# SP025 — Webhooks and external integration runtime

Working status: `SPECIFICATION_READY`  
Implementation status: `NOT_STARTED`  
Product status: `NOT_READY`

## [SPEC-IDENTITY] Identity
- Shared-platform ID: `SP025`
- Category: **Integration runtime**
- Owner: **Security**
- Priority: **P0**
- Canonical business count impact: **NONE**.

## [SPEC-INTENT] Intent
Provide signed outbound/inbound webhooks, secret rotation, event subscriptions, retry/backoff, dedupe, delivery logs and safe connector boundaries.

## [SPEC-OUTCOMES] Outcomes
One governed reusable implementation serves all applicable modules; Webhooks and external integration runtime remains consistent across web, API, worker and mobile.

## [SPEC-PERSONAS] Personas
Tenant administrators, ERP users, managers/approvers, security/operations personnel, integration clients and implementation agents as applicable; negative-permission personas are mandatory.

## [SPEC-ENTRY-POINTS] Entry Points
Administration/settings where configured and protected runtime/API/mobile/worker paths where Webhooks and external integration runtime is consumed.

## [SPEC-BENCHMARK] Benchmark
Evidence IDs: `SP025-SRC-SP-OWASP-API`, `SP025-SRC-SP-RFC-9110`, `SP025-SRC-SP-NIST-SSDF`.

## [SPEC-DECISION] Decision
`DEC-SP025` freezes this exact shared-platform identity and scope.

## [SPEC-OMISSION-GATE] Omission Gate
Red-team Webhooks and external integration runtime for lifecycle, authorization, multi-company/tenant scope, stale state, concurrency, retry, recovery, reporting, mobile, accessibility, observability and operations.

## [SPEC-SUBCAPABILITIES] Subcapabilities
Requirement families: `SP025-CAP-###`, `SP025-FR-###`, `SP025-US-###`, `SP025-FLOW-###`, `SP025-BR-###`, `SP025-DATA-###`, `SP025-VAL-###`, `SP025-CALC-###`, `SP025-UX-###`, `SP025-SEC-###`, `SP025-AUTO-###`, `SP025-APP-###`, `SP025-NOTIF-###`, `SP025-REP-###`, `SP025-AI-###`, `SP025-INT-###`, `SP025-API-###`, `SP025-PERF-###`, `SP025-OBS-###`, `SP025-E2E-###`, `SP025-UAT-###`.

## [SPEC-FUNCTIONAL] Functional
Approved FRs: `SP025-FR-001`, `SP025-FR-002`, `SP025-FR-003`.

## [SPEC-FLOWS] Flows
Register endpoint/secret -> event -> sign/send -> retry/log -> disable unhealthy endpoint; inbound -> verify -> dedupe -> public command -> reconcile.

## [SPEC-STATE-MACHINE] State Machine
Lifecycle/request/job states for Webhooks and external integration runtime must be explicit; invalid transitions fail before side effects and recovery/reopen is auditable.

## [SPEC-DATA] Data
Data owned by Webhooks and external integration runtime is tenant/company scoped where applicable, typed, version/effective-dated when policy changes, and classified for retention/security.

## [SPEC-VALIDATION] Validation
Validate identity/scope, lifecycle, schema, references, stale versions, duplicates and policy before mutation.

## [SPEC-BUSINESS-RULES] Business Rules
- Webhook signatures/secrets are verified before business processing.
- Inbound callbacks are idempotent and reconciled with authoritative provider truth.
- Outbound delivery never leaks unauthorized tenant data.

## [SPEC-CALCULATIONS] Calculations
Any quotas/windows/usage/retry/timestamp-derived values in Webhooks and external integration runtime use explicit deterministic precision/timezone rules.

## [SPEC-VIEWS] Views
Provide only justified admin/operator views for Webhooks and external integration runtime using Experience Kernel states.

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
Dependencies: SP015,SP016,SP024.

## [SPEC-AUTOMATION] Automation
Automation consumes Webhooks and external integration runtime only through normal public commands/authorization.

## [SPEC-APPROVALS] Approvals
Use centralized approval/SoD when changing Webhooks and external integration runtime materially affects security, money, access, data exposure or production operations.

## [SPEC-NOTIFICATIONS] Notifications
Notify responsible actors for actionable Webhooks and external integration runtime failures, approvals, expirations or security events.

## [SPEC-DOCUMENTS] Documents
Documents/attachments used by Webhooks and external integration runtime obey SP019 file security, scope, version and retention.

## [SPEC-IMPORT-EXPORT] Import Export
Import/export of Webhooks and external integration runtime configuration/evidence is permission-scoped, validated and auditable.

## [SPEC-REPORTING] Reporting
Report health, usage, exceptions, audit and policy state for Webhooks and external integration runtime, including source/freshness.

## [SPEC-AI] Ai
AI may assist/explain Webhooks and external integration runtime only from authorized context and cannot bypass deterministic controls.

## [SPEC-SECURITY] Security
Replay, forged signatures, SSRF, secret leakage, endpoint takeover and duplicate payment/business effects are primary threats. Security-negative and abuse tests are mandatory.

## [SPEC-SCOPE] Scope
Resolve organization, entitlement, company, branch/site/team/record/field context as applicable; jobs/integrations use trusted persisted scope.

## [SPEC-AUDIT] Audit
Sensitive/high-impact Webhooks and external integration runtime changes produce durable actor/tenant/target/correlation evidence with secret/PII minimization.

## [SPEC-CONCURRENCY] Concurrency
Identify races in Webhooks and external integration runtime; enforce DB constraints/locks/version checks or another documented safe mechanism.

## [SPEC-IDEMPOTENCY] Idempotency
Retries in Webhooks and external integration runtime are classified; unsafe duplicate effects use stable idempotency/business keys and reconciliation.

## [SPEC-INTEGRATIONS] Integrations
Integration contracts involving Webhooks and external integration runtime are versioned, tenant-scoped, observable and replay-safe.

## [SPEC-API] Api
APIs use authenticated/versioned contracts, object/function/property authorization, bounded resource use and typed errors.

## [SPEC-MOBILE] Mobile
Classify Webhooks and external integration runtime as full, field-optimized, approval-only, read-only or not-applicable; offline state is bounded/encrypted and revalidated.

## [SPEC-RESPONSIVE] Responsive
Desktop/tablet/phone behavior follows the Experience Kernel and preserves critical actions.

## [SPEC-ACCESSIBILITY] Accessibility
WCAG 2.2 AA intent: keyboard/focus, labels, screen-reader status/errors, contrast, target size, zoom/reflow, reduced motion and non-drag alternatives.

## [SPEC-VISUAL-EVIDENCE] Visual Evidence
Complex Webhooks and external integration runtime admin/operator surfaces require wireframes/state diagrams before implementation.

## [SPEC-PERFORMANCE] Performance
Define latency/throughput/cardinality/volume budgets for Webhooks and external integration runtime; use batching/pagination/async/read models where appropriate.

## [SPEC-OBSERVABILITY] Observability
Structured logs/metrics/traces with correlation, diagnostics, alerts and reconciliation support are required for Webhooks and external integration runtime.

## [SPEC-EDGE-CASES] Edge Cases
Cover duplicates, stale references, concurrency, permission changes, partial failures, retries, outages, timezones/localization and recovery.

## [SPEC-CODE-AUDIT] Code Audit
Before implementation, map current repository paths/symbols to SP025 and classify VERIFIED/PARTIAL/MISSING; code never lowers target requirements.

## [SPEC-GAPS] Gaps
Target minus verified behavior is the implementation gap; framework existence alone is not proof that Webhooks and external integration runtime is complete.

## [SPEC-IMPLEMENTATION] Implementation
Implement in existing core/packages/worker/database/mobile/shared areas as appropriate; business modules consume public contracts. Pass A changes docs only.

## [SPEC-TESTS] Tests
Unit/domain, DB/RLS, API, security-negative, integration, idempotency/retry, performance, migration and reconciliation tests are planned.

## [SPEC-E2E] E2E
`SP025-TEST-E2E-01` happy path and `SP025-TEST-E2E-02` negative/recovery path are planned.

## [SPEC-UAT] Uat
`SP025-UAT-01` and `SP025-UAT-02` cover primary and failure/permission/recovery validation.

## [SPEC-DOD] Dod
SP025 is specification-ready because identity/scope, atomic requirements, primary evidence, decisions, dependencies, tests and UAT are materialized. It is not implementation/product ready.

## [SPEC-OPEN-DECISIONS] Open Decisions
No freeze-blocking identity/scope decision remains; implementation-specific choices remain governed by existing ADR/change control.
