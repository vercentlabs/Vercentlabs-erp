# SP036 — AI governance, Copilot runtime and evaluation

Working status: `SPECIFICATION_READY`  
Implementation status: `NOT_STARTED`  
Product status: `NOT_READY`

## [SPEC-IDENTITY] Identity
- Shared-platform ID: `SP036`
- Category: **AI**
- Owner: **AI Platform**
- Priority: **P0**
- Canonical business count impact: **NONE**.

## [SPEC-INTENT] Intent
Govern customer-facing ERP AI and engineering-assistant integrations with authorization-safe retrieval, provenance, approval gates, evaluations, prompt/data isolation and no direct authoritative writes.

## [SPEC-OUTCOMES] Outcomes
One governed reusable implementation serves all applicable modules; AI governance, Copilot runtime and evaluation remains consistent across web, API, worker and mobile.

## [SPEC-PERSONAS] Personas
Tenant administrators, ERP users, managers/approvers, security/operations personnel, integration clients and implementation agents as applicable; negative-permission personas are mandatory.

## [SPEC-ENTRY-POINTS] Entry Points
Administration/settings where configured and protected runtime/API/mobile/worker paths where AI governance, Copilot runtime and evaluation is consumed.

## [SPEC-BENCHMARK] Benchmark
Evidence IDs: `SP036-SRC-SP-NIST-AI-600-1`, `SP036-SRC-SP-OWASP-API`, `SP036-SRC-SP-NIST-SSDF`.

## [SPEC-DECISION] Decision
`DEC-SP036` freezes this exact shared-platform identity and scope.

## [SPEC-OMISSION-GATE] Omission Gate
Red-team AI governance, Copilot runtime and evaluation for lifecycle, authorization, multi-company/tenant scope, stale state, concurrency, retry, recovery, reporting, mobile, accessibility, observability and operations.

## [SPEC-SUBCAPABILITIES] Subcapabilities
Requirement families: `SP036-CAP-###`, `SP036-FR-###`, `SP036-US-###`, `SP036-FLOW-###`, `SP036-BR-###`, `SP036-DATA-###`, `SP036-VAL-###`, `SP036-CALC-###`, `SP036-UX-###`, `SP036-SEC-###`, `SP036-AUTO-###`, `SP036-APP-###`, `SP036-NOTIF-###`, `SP036-REP-###`, `SP036-AI-###`, `SP036-INT-###`, `SP036-API-###`, `SP036-PERF-###`, `SP036-OBS-###`, `SP036-E2E-###`, `SP036-UAT-###`.

## [SPEC-FUNCTIONAL] Functional
Approved FRs: `SP036-FR-001`, `SP036-FR-002`, `SP036-FR-003`.

## [SPEC-FLOWS] Flows
User asks -> resolve tenant/permissions -> retrieve authorized context -> model -> cite/provenance -> propose action -> normal command/approval -> audit; evals monitor quality/safety/drift.

## [SPEC-STATE-MACHINE] State Machine
Lifecycle/request/job states for AI governance, Copilot runtime and evaluation must be explicit; invalid transitions fail before side effects and recovery/reopen is auditable.

## [SPEC-DATA] Data
Data owned by AI governance, Copilot runtime and evaluation is tenant/company scoped where applicable, typed, version/effective-dated when policy changes, and classified for retention/security.

## [SPEC-VALIDATION] Validation
Validate identity/scope, lifecycle, schema, references, stale versions, duplicates and policy before mutation.

## [SPEC-BUSINESS-RULES] Business Rules
- AI never bypasses normal permissions/public commands or writes business tables directly.
- Deterministic systems remain authority for ledger, stock, payroll, tax, payment, authorization and state-transition legality.
- High-impact automation requires explicit policy/approval; model outputs retain provenance and uncertainty.

## [SPEC-CALCULATIONS] Calculations
Any quotas/windows/usage/retry/timestamp-derived values in AI governance, Copilot runtime and evaluation use explicit deterministic precision/timezone rules.

## [SPEC-VIEWS] Views
Provide only justified admin/operator views for AI governance, Copilot runtime and evaluation using Experience Kernel states.

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
Dependencies: SP008,SP009,SP014,SP024,SP029,SP030.

## [SPEC-AUTOMATION] Automation
Automation consumes AI governance, Copilot runtime and evaluation only through normal public commands/authorization.

## [SPEC-APPROVALS] Approvals
Use centralized approval/SoD when changing AI governance, Copilot runtime and evaluation materially affects security, money, access, data exposure or production operations.

## [SPEC-NOTIFICATIONS] Notifications
Notify responsible actors for actionable AI governance, Copilot runtime and evaluation failures, approvals, expirations or security events.

## [SPEC-DOCUMENTS] Documents
Documents/attachments used by AI governance, Copilot runtime and evaluation obey SP019 file security, scope, version and retention.

## [SPEC-IMPORT-EXPORT] Import Export
Import/export of AI governance, Copilot runtime and evaluation configuration/evidence is permission-scoped, validated and auditable.

## [SPEC-REPORTING] Reporting
Report health, usage, exceptions, audit and policy state for AI governance, Copilot runtime and evaluation, including source/freshness.

## [SPEC-AI] Ai
AI may assist/explain AI governance, Copilot runtime and evaluation only from authorized context and cannot bypass deterministic controls.

## [SPEC-SECURITY] Security
Prompt injection, cross-tenant context leakage, hallucinated authority, unsafe tool use, data retention leakage and model drift are primary threats. Security-negative and abuse tests are mandatory.

## [SPEC-SCOPE] Scope
Resolve organization, entitlement, company, branch/site/team/record/field context as applicable; jobs/integrations use trusted persisted scope.

## [SPEC-AUDIT] Audit
Sensitive/high-impact AI governance, Copilot runtime and evaluation changes produce durable actor/tenant/target/correlation evidence with secret/PII minimization.

## [SPEC-CONCURRENCY] Concurrency
Identify races in AI governance, Copilot runtime and evaluation; enforce DB constraints/locks/version checks or another documented safe mechanism.

## [SPEC-IDEMPOTENCY] Idempotency
Retries in AI governance, Copilot runtime and evaluation are classified; unsafe duplicate effects use stable idempotency/business keys and reconciliation.

## [SPEC-INTEGRATIONS] Integrations
Integration contracts involving AI governance, Copilot runtime and evaluation are versioned, tenant-scoped, observable and replay-safe.

## [SPEC-API] Api
APIs use authenticated/versioned contracts, object/function/property authorization, bounded resource use and typed errors.

## [SPEC-MOBILE] Mobile
Classify AI governance, Copilot runtime and evaluation as full, field-optimized, approval-only, read-only or not-applicable; offline state is bounded/encrypted and revalidated.

## [SPEC-RESPONSIVE] Responsive
Desktop/tablet/phone behavior follows the Experience Kernel and preserves critical actions.

## [SPEC-ACCESSIBILITY] Accessibility
WCAG 2.2 AA intent: keyboard/focus, labels, screen-reader status/errors, contrast, target size, zoom/reflow, reduced motion and non-drag alternatives.

## [SPEC-VISUAL-EVIDENCE] Visual Evidence
Complex AI governance, Copilot runtime and evaluation admin/operator surfaces require wireframes/state diagrams before implementation.

## [SPEC-PERFORMANCE] Performance
Define latency/throughput/cardinality/volume budgets for AI governance, Copilot runtime and evaluation; use batching/pagination/async/read models where appropriate.

## [SPEC-OBSERVABILITY] Observability
Structured logs/metrics/traces with correlation, diagnostics, alerts and reconciliation support are required for AI governance, Copilot runtime and evaluation.

## [SPEC-EDGE-CASES] Edge Cases
Cover duplicates, stale references, concurrency, permission changes, partial failures, retries, outages, timezones/localization and recovery.

## [SPEC-CODE-AUDIT] Code Audit
Before implementation, map current repository paths/symbols to SP036 and classify VERIFIED/PARTIAL/MISSING; code never lowers target requirements.

## [SPEC-GAPS] Gaps
Target minus verified behavior is the implementation gap; framework existence alone is not proof that AI governance, Copilot runtime and evaluation is complete.

## [SPEC-IMPLEMENTATION] Implementation
Implement in existing core/packages/worker/database/mobile/shared areas as appropriate; business modules consume public contracts. Pass A changes docs only.

## [SPEC-TESTS] Tests
Unit/domain, DB/RLS, API, security-negative, integration, idempotency/retry, performance, migration and reconciliation tests are planned.

## [SPEC-E2E] E2E
`SP036-TEST-E2E-01` happy path and `SP036-TEST-E2E-02` negative/recovery path are planned.

## [SPEC-UAT] Uat
`SP036-UAT-01` and `SP036-UAT-02` cover primary and failure/permission/recovery validation.

## [SPEC-DOD] Dod
SP036 is specification-ready because identity/scope, atomic requirements, primary evidence, decisions, dependencies, tests and UAT are materialized. It is not implementation/product ready.

## [SPEC-OPEN-DECISIONS] Open Decisions
No freeze-blocking identity/scope decision remains; implementation-specific choices remain governed by existing ADR/change control.
