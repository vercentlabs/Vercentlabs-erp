# F021 — Lead import and export

## [SPEC-IDENTITY] Identity and traceability
- Canonical ID: `F021`
- Canonical name: **Lead import and export**
- Module: **CRM**
- Working status: `SPECIFICATION_READY`
- Readiness gate: `SPECIFICATION_READY`
- Implementation status: `NOT_STARTED`
- Product status: `NOT_READY`
- Parent capability IDs: `CRM-CAP-006`
- Canonical source: `docs/02-register/FEATURE_REGISTER.csv`
- Pass: `1 / CRM F001-F030`

## [SPEC-INTENT] Product intent and business problem
**Intent.** Move lead data in and out at enterprise volume without bypassing validation, duplicate, permission or audit rules.

**Non-goal.** This specification does not certify existing code as implemented/product-ready and does not move another module's private domain logic into CRM.

## [SPEC-OUTCOMES] Business outcomes and success measures
- Authorized operators can upload, map, validate, review duplicates and commit an import with a recoverable result report.
- Data/history remains explainable, permission-safe and recoverable under normal error/retry conditions.
- Manager/operations users can govern and reconcile the capability at enterprise volume.
- Success metrics include task completion/latency, data quality, lifecycle velocity, failure/retry rate and feature-specific reporting defined by `F021-REP-001`.

## [SPEC-PERSONAS] Personas and jobs to be done
- Primary personas: `OPS; ADMIN`.
- Front-line JTBD: upload, map, validate, review duplicates and commit an import with a recoverable result report.
- Manager/OPS JTBD: inspect configuration, exceptions, history, workload and KPI impact within permitted scope.
- Negative-permission persona: a user outside the record/company/team/content scope must not infer the record through search, counts, exports, timeline, reporting or AI.

## [SPEC-ENTRY-POINTS] Entry points, navigation and deep links
Entry through the CRM navigation, command/search results, related-record panels, dashboards/work queues and durable record deep links. Contextual create/actions must preserve the originating record and return path. Mobile prioritizes the high-frequency front-line path; configuration remains desktop-first where appropriate.

## [SPEC-BENCHMARK] Benchmark research evidence
Official benchmark evidence IDs:
- `CRM-P1-BE-041`
- `CRM-P1-BE-042`

These are current official-product observations used as design-space evidence, not claims that Vercentlabs already implements the behavior.

## [SPEC-DECISION] Vercentlabs benchmark decisions
- `DEC-CRM-P1-F021` — REQUIRED enterprise scope: dry run, upsert policy, formula injection, malicious content, async/resume, partial failure, idempotency and unauthorized export.
- Module decisions `DEC-CRM-P1-BOUNDARY`, `DEC-CRM-P1-AI`, `DEC-CRM-P1-SECURITY`, `DEC-CRM-P1-HISTORY` and `DEC-CRM-P1-ACCESSIBILITY` apply.
- Benchmark disposition: adopt the user-value/control pattern while preserving Vercentlabs modular architecture and deterministic authority.

## [SPEC-OMISSION-GATE] Enterprise omission gate
Reviewed hidden expectations: dry run, upsert policy, formula injection, malicious content, async/resume, partial failure, idempotency and unauthorized export.

The omission challenge explicitly asks whether interactive, import, bulk, automation, integration and AI paths enforce the same rules; whether concurrency/retry can duplicate effects; whether history/reporting remain reproducible; whether mobile/keyboard users can complete the critical job; and whether downstream modules consume only public contracts. No material omission is intentionally left unreviewed for specification readiness.

## [SPEC-SUBCAPABILITIES] Sub-capabilities and capability mapping
- `F021-CAP-001` — The Lead import and export capability MUST let authorized OPS; ADMIN users upload, map, validate, review duplicates and commit an import with a recoverable result report.
- `F021-CAP-002` — The capability MUST include the reviewed enterprise expectations for dry run, upsert policy, formula injection, malicious content, async/resume, partial failure, idempotency and unauthorized export and MUST NOT treat the short canonical label as the full scope.
- `F021-CAP-003` — Imports use the same CRM create/update/duplicate policies as interactive commands; exports enforce identical row/field scope.

## [SPEC-FUNCTIONAL] Functional requirements and user stories
- `F021-FR-001` — The system MUST provide a complete server-backed workflow to upload, map, validate, review duplicates and commit an import with a recoverable result report, including success, empty, validation, permission and conflict states.
- `F021-FR-002` — Every material Lead import and export mutation MUST leave durable history sufficient to explain actor, time, previous state, new state and reason where applicable.
- `F021-FR-003` — The feature MUST remain usable for individual work and enterprise list/bulk volumes using pagination, virtualization or asynchronous jobs when thresholds are crossed.
- `F021-US-001` — As an authorized front-line user, I can upload, map, validate, review duplicates and commit an import with a recoverable result report without navigating to raw technical resources or losing related-record context.
- `F021-US-002` — As a manager or operations user, I can inspect, govern and audit Lead import and export behavior across my permitted team/company scope.

## [SPEC-FLOWS] Primary, alternate, exception, retry and reversal flows
- `F021-FLOW-001` — The primary flow MUST follow the governed lifecycle `UPLOADED -> MAPPED -> VALIDATED -> READY -> PROCESSING -> COMPLETED | PARTIAL | FAILED` and expose alternate/cancel paths where the lifecycle permits them.
- `F021-FLOW-002` — Validation failures, authorization denials, concurrency conflicts and retryable integration failures MUST be visible, actionable and safe to retry without duplicate business effects.

## [SPEC-STATE-MACHINE] State machine and transition rules
**Aggregate lifecycle:** `UPLOADED -> MAPPED -> VALIDATED -> READY -> PROCESSING -> COMPLETED | PARTIAL | FAILED`.

Commands must declare legal source state, target state, permissions, guards, side effects, audit event and recovery semantics. Derived display states must not silently rewrite authoritative lifecycle facts.

## [SPEC-DATA] Data model, entities, relationships and fields
- `F021-DATA-001` — The authoritative data model MUST explicitly govern crm_lead_import_batches; crm_lead_import_rows; crm_import_receipts; crm_leads with organization identifiers, stable keys, lifecycle timestamps and indexes appropriate to access patterns.
- `F021-DATA-002` — System-derived and externally sourced values MUST retain provenance/lineage, and retention/deletion behavior MUST preserve legally or operationally required audit links.

Primary audited structures: `crm_lead_import_batches; crm_lead_import_rows; crm_import_receipts; crm_leads`. IDs are stable; organization ownership is explicit; related-record references are validated; mutable business records carry concurrency metadata; history/event rows retain lineage.

## [SPEC-VALIDATION] Validation rules
- `F021-VAL-001` — All create/update/transition commands MUST validate required fields, references, organization/company scope, lifecycle legality and normalized input server-side before persistence.
- `F021-VAL-002` — Validation failures MUST return stable CRM error codes plus user-actionable messages without leaking restricted record existence or sensitive values.

## [SPEC-BUSINESS-RULES] Business rules and invariants
- `F021-BR-001` — The owning CRM domain command/service is authoritative for Lead import and export; UI, import, bulk, automation and AI paths MUST reuse the same business rules.
- `F021-BR-002` — Configuration or later edits MUST NOT rewrite historical Lead import and export events needed for audit, reporting or reproducibility.

## [SPEC-CALCULATIONS] Calculations, precision and rounding
- `F021-CALC-001` — Import counts, error rates and progress are deterministic job metrics; export counts reflect authorization-filtered rows only.

## [SPEC-VIEWS] Required view archetypes
- `F021-UX-001` — The primary Lead import and export workspace MUST expose the next meaningful action above the fold and keep high-frequency context/actions within one consistent CRM shell.
- `F021-UX-002` — List/detail/create/edit surfaces MUST specify loading, empty, error, permission, stale/conflict and destructive-action states with immediate progress/confirmation feedback.
- `F021-UX-003` — Critical Lead import and export actions MUST work on desktop, tablet and phone with full keyboard operation, visible focus, semantic labels, non-drag alternatives and no horizontal content loss except intentional boards/tables.

Applicable archetypes are chosen by operator job: list/work queue for volume, 360 detail for context, board/calendar/dashboard only where the domain benefits. Loading/empty/error/conflict/permission states are mandatory.

## [SPEC-LIST] List, table and work-queue behavior
Lists use stable cursor/page semantics, configurable visible columns where useful, dense but readable row states, selection that never expands record scope, row-level quick actions and virtualization or async jobs for large sets. Counts are authorization-safe.

## [SPEC-SEARCH] Search, filters, sorting and saved views
Search uses normalized indexed fields and stable sort tie-breakers. Filters expose explicit operators, URL/deep-link state where safe, personal/shared saved views with permission checks, and no counts/facets for inaccessible records.

## [SPEC-DETAIL] Detail / 360 workspace
The detail workspace prioritizes identity/state/owner and the next meaningful action, then related records, timeline/history, notes/communications and feature-specific insights. Every related panel independently enforces permission/content scope.

## [SPEC-CREATE] Create and quick-create UX
Create uses contextual defaults but never trusts client-supplied ownership/scope. Required references, duplicate/precondition checks and validation are visible before commit where practical. Successful creation returns to the new record or originating workflow predictably.

## [SPEC-EDIT] Edit, inline edit and immutable fields
Edits use optimistic concurrency. Immutable/system/history fields are not editable. Dependent fields are revalidated server-side, unsaved changes are protected, and conflict UI shows refresh/retry rather than overwriting a newer record.

## [SPEC-BULK] Bulk actions and selection semantics
Bulk behavior is governed by F029. When Lead import and export participates, each record is re-authorized and validated through the normal domain command; selection may be explicit IDs or a stable filter snapshot; partial results are reported rather than silently ignored.

## [SPEC-ACTIONS] Primary, secondary, contextual and destructive actions
Primary action: upload, map, validate, review duplicates and commit an import with a recoverable result report. Secondary/destructive actions are available only when state + permission + scope permit them. Destructive/irreversible operations require explicit confirmation/reason where applicable and have keyboard/mobile equivalents.

## [SPEC-RELATED] Related records and contextual navigation
Related records are queried through authorized relationships around `crm_lead_import_batches; crm_lead_import_rows; crm_import_receipts; crm_leads`. Create-from-context pre-fills only safe references; counts/previews cannot reveal inaccessible child records; deep links preserve tenant/company context.

## [SPEC-AUTOMATION] Automation and workflow engine behavior
- `F021-AUTO-001` — Approved automation may act on Lead import and export only through normal domain commands with trigger provenance, recursion control, retry policy, audit and operator visibility.

## [SPEC-APPROVALS] Approvals, maker-checker and segregation of duties
- `F021-APP-001` — Ordinary low-risk Lead import and export work does not require a universal approval; elevated overrides, destructive merges, high-impact bulk changes or configured thresholds MUST require the explicit permission/approval policy and reason.

## [SPEC-NOTIFICATIONS] Notifications and communication behavior
- `F021-NOTIF-001` — Notifications for Lead import and export MUST be event-driven, permission-safe, preference-aware, deduplicated on retry and include a durable deep link when the recipient remains authorized.

## [SPEC-DOCUMENTS] Attachments, generated documents, print and templates
Where files/generated documents apply, parent-record authorization is inherited, storage keys are server-owned, MIME/content and malware checks precede READY state, and retention/versioning is explicit. If the feature has no native document, this contract applies only to related attachments and no extra document type is invented.

## [SPEC-IMPORT-EXPORT] Import, export and migration behavior
F021 governs lead import/export. For Lead import and export, any generic import/export path must reuse server validation, duplicate/record-scope rules and audit. Exports apply row/field/content authorization before materialization; large operations are asynchronous and produce a result manifest.

## [SPEC-REPORTING] Reports, KPIs, analytics and drilldown
- `F021-REP-001` — Reports/KPIs for Lead import and export MUST define formula, dimensions, time basis, freshness, currency/units where applicable, permission-safe aggregation and drill-down reconciliation.

## [SPEC-AI] AI opportunities, authority boundary and safeguards
- `F021-AI-001` — AI class is `AI_RECOMMEND`. AI MAY assist/recommend/generate only within the caller's normal data permissions and MUST expose provenance, model/version, uncertainty/reasons where applicable and a deterministic/human fallback; it MUST NOT bypass normal mutation authority.

Decision: `AI_RECOMMEND`. Deterministic authorization/state/calculation rules remain authoritative.

## [SPEC-SECURITY] Security, permissions and field controls
- `F021-SEC-001` — Every Lead import and export query and command MUST enforce server-side organization, company/branch where applicable, team/owner/record scope and action permission before returning or mutating data.
- `F021-SEC-002` — Sensitive fields/content MUST support stricter field/content visibility than record visibility, and negative tests MUST prove unauthorized users cannot infer data via search counts, reports, timeline, exports, AI or errors.

## [SPEC-SCOPE] Tenant, company, branch, team, owner and record scope
All reads/writes are organization-scoped; company/branch/location scope applies where the record model uses it; team/territory/owner/record scope composes with action permissions. Cross-company exceptions require an explicit authorized contract, never an omitted predicate.

## [SPEC-AUDIT] Auditability and history
Material mutations record actor/service identity, channel, timestamp, reason where required, before/after or event payload, request/correlation ID and links to approval/reversal/downstream result. Operator-visible history must be consistent with tamper-resistant backend audit evidence.

## [SPEC-CONCURRENCY] Concurrency and conflict handling
Mutable aggregates use optimistic version/updated-at preconditions. Stale writes fail with a conflict code and recoverable UI. Multi-row allocation/merge/conversion/forecast/bulk operations use the transaction/locking strategy required to preserve invariants and retry deadlocks safely.

## [SPEC-IDEMPOTENCY] Idempotency, retry safety and exactly-once business effects
Non-repeatable commands (conversion, merge, provider webhook/sync, bulk job creation, downstream handoff) require idempotency identity and replay/no-op semantics. Outbox/worker effects are at-least-once technically but exactly-once at the business effect through deduplication/reconciliation.

## [SPEC-INTEGRATIONS] Cross-module and external integrations
- `F021-INT-001` — Imports use the same CRM create/update/duplicate policies as interactive commands; exports enforce identical row/field scope.
- `F021-INT-002` — Every external or cross-module effect for Lead import and export MUST define idempotency, retry ownership, failure visibility, compensation/reversal where possible and an operator reconciliation path.

## [SPEC-API] Commands, queries and API contracts
- `F021-API-001` — Mutating Lead import and export APIs MUST have explicit request/response/error schemas, authorization, optimistic concurrency where records are editable, audit/correlation metadata and idempotency for non-repeatable commands.
- `F021-API-002` — Lead import and export list/search/detail APIs MUST use bounded pagination, stable sorting/filter semantics, permission-safe counts and compatibility/versioning rules.

Target envelope includes stable data/error code and request/correlation metadata. Existing route shapes may be retained where compatible; the specification defines behavior, not gratuitous URL churn.

## [SPEC-MOBILE] Mobile-specific and offline behavior
High-frequency seller reads/actions must have a mobile path with card/reflow layout, secure local/offline caching only where explicitly supported, queued writes only for safe commands, conflict resolution on reconnect and no storage of unnecessary sensitive content. Administrative builders can remain desktop-first.

## [SPEC-RESPONSIVE] Responsive behavior
Desktop favors dense grid/360 productivity; tablet reflows side panels and action groups; phone uses stacked cards/sections and bottom/full-screen actions. Intentional boards may scroll horizontally but must expose a non-drag action and never hide the only path to a business transition.

## [SPEC-ACCESSIBILITY] Accessibility contract
WCAG 2.2 AA intent: semantic landmarks/headings/labels, full keyboard path, visible/non-obscured focus, screen-reader status announcements, actionable error association, non-color-only states, target sizing, reduced motion and non-drag alternatives for board interactions.

## [SPEC-VISUAL-EVIDENCE] Wireframes, diagrams and visual evidence
Reference: `docs/11-visual-assets/wireframes/CRM_PASS1_WORKSPACES.md`. It defines desktop/tablet/mobile CRM shell, list/360, pipeline, activity, forecast/report patterns and loading/empty/error/conflict/permission states.

## [SPEC-PERFORMANCE] Performance, scale and data-volume envelope
- `F021-PERF-001` — Normal Lead import and export record reads SHOULD meet p95 <=400ms server response, filtered lists <=600ms and standard mutations <=750ms on representative datasets; large jobs MUST become asynchronous.

## [SPEC-OBSERVABILITY] Logs, metrics, traces, jobs and support diagnostics
- `F021-OBS-001` — The system MUST emit correlation IDs, structured non-PII logs, business/technical metrics and retry/dead-letter/reconciliation diagnostics sufficient to explain Lead import and export failures without exposing sensitive content.

## [SPEC-EDGE-CASES] Edge cases, abuse cases and recovery
Cover empty/min/max values, Unicode/long text, stale references, duplicates, concurrent actors, deactivated configuration, timezone/DST where temporal, permission changes mid-session, partial provider/outbox failure, retry storms, deleted/merged related records and attempts to use import/bulk/AI as an authorization bypass.

## [SPEC-CODE-AUDIT] Current-code evidence audit
Verified code evidence: `CRM-P1-CODE-021` at `apps/web/src/app/api/crm/[resource]/import/route.ts`.

Finding: Generic CRM import/export routes and acquisition import infrastructure exist; pass must define safe mapping, async jobs and row-level results.

Interpretation: presence of code is implementation evidence only. Target requirements are not weakened to match the current implementation.

## [SPEC-GAPS] Exact gap analysis
Pass 1 gap class: existing implementation must be mapped/tested requirement-by-requirement against this target, especially dry run, upsert policy, formula injection, malicious content, async/resume, partial failure, idempotency and unauthorized export. Any absent/partial behavior becomes an implementation backlog item later; this dossier does not claim the code is already complete.

## [SPEC-IMPLEMENTATION] Implementation map and dependency order
Likely implementation areas include the audited path `apps/web/src/app/api/crm/[resource]/import/route.ts`, CRM module/domain services, tenant migrations/data contracts, shared CRM workspace primitives, mobile where high-frequency, and tests. Sequence: preserve public contracts -> close data/state/security gaps -> UI/automation/integration -> tests/E2E/performance/UAT. No product source code is modified by this specification pass.

## [SPEC-TESTS] Automated test plan
Unit/domain tests cover invariants and calculations; database tests cover constraints/RLS where applicable; API tests cover schemas/authorization/concurrency/idempotency; integration tests cover retries/outbox/providers; performance tests cover representative volume; migration tests prove historical compatibility and reconciliation.

## [SPEC-E2E] Browser and critical-journey E2E
- `F021-E2E-001` — Browser E2E MUST prove an authorized user can upload, map, validate, review duplicates and commit an import with a recoverable result report and an unauthorized user cannot perform or infer the same action/data.
- `F021-E2E-002` — Browser/API E2E MUST prove stale-write/conflict or retryable failure behavior for Lead import and export is visible, recoverable and does not duplicate business effects.

## [SPEC-UAT] Human UAT plan
- `F021-UAT-001` — Human UAT MUST have a front-line persona execute the primary Lead import and export job on desktop and a high-frequency mobile/tablet path, capturing visible result and audit evidence.
- `F021-UAT-002` — Human UAT MUST have a manager/operations persona exercise one permission/exception/override or reconciliation case and confirm reporting/history reflect the outcome.

## [SPEC-DOD] Objective Definition of Done
Specification DoD is satisfied when all materialized `F021-*` requirements are approved, both benchmark evidence rows and verified code audit exist, 54 sections are complete, omission review has no unresolved material placeholder, visual/API/security/test/UAT contracts are present, and validators pass. Product DoD is explicitly **not** satisfied by this pass.

## [SPEC-OPEN-DECISIONS] Open decisions, assumptions and risks
No material specification blocker remains. Implementation-time choices (exact component composition, migration mechanics, provider adapters and measured performance tuning) must remain within these contracts and be recorded as new decision IDs if they change behavior. Sales F036 is not pre-certified; only the CRM side of F023's public handoff is fixed here.
