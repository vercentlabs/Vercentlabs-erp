# F002 — Accounts / companies

## [SPEC-IDENTITY] Identity and traceability
- Canonical ID: `F002`
- Canonical name: **Accounts / companies**
- Module: **CRM**
- Working status: `SPECIFICATION_READY`
- Readiness gate: `SPECIFICATION_READY`
- Implementation status: `NOT_STARTED`
- Product status: `NOT_READY`
- Parent capability IDs: `CRM-CAP-001`
- Canonical source: `docs/02-register/FEATURE_REGISTER.csv`
- Pass: `1 / CRM F001-F030`

## [SPEC-INTENT] Product intent and business problem
**Intent.** Maintain one trusted commercial organization record and a permission-safe customer/company 360.

**Non-goal.** This specification does not certify existing code as implemented/product-ready and does not move another module's private domain logic into CRM.

## [SPEC-OUTCOMES] Business outcomes and success measures
- Authorized operators can open a company 360, manage relationships and resolve duplicates/hierarchy safely.
- Data/history remains explainable, permission-safe and recoverable under normal error/retry conditions.
- Manager/operations users can govern and reconcile the capability at enterprise volume.
- Success metrics include task completion/latency, data quality, lifecycle velocity, failure/retry rate and feature-specific reporting defined by `F002-REP-001`.

## [SPEC-PERSONAS] Personas and jobs to be done
- Primary personas: `REP; MGR; OPS; ADMIN`.
- Front-line JTBD: open a company 360, manage relationships and resolve duplicates/hierarchy safely.
- Manager/OPS JTBD: inspect configuration, exceptions, history, workload and KPI impact within permitted scope.
- Negative-permission persona: a user outside the record/company/team/content scope must not infer the record through search, counts, exports, timeline, reporting or AI.

## [SPEC-ENTRY-POINTS] Entry points, navigation and deep links
Entry through the CRM navigation, command/search results, related-record panels, dashboards/work queues and durable record deep links. Contextual create/actions must preserve the originating record and return path. Mobile prioritizes the high-frequency front-line path; configuration remains desktop-first where appropriate.

## [SPEC-BENCHMARK] Benchmark research evidence
Official benchmark evidence IDs:
- `CRM-P1-BE-003`
- `CRM-P1-BE-004`

These are current official-product observations used as design-space evidence, not claims that Vercentlabs already implements the behavior.

## [SPEC-DECISION] Vercentlabs benchmark decisions
- `DEC-CRM-P1-F002` — REQUIRED enterprise scope: hierarchy cycles, site relationships, merge survivorship, legal identifiers, shared CRM/Sales ownership and sensitive relationship visibility.
- Module decisions `DEC-CRM-P1-BOUNDARY`, `DEC-CRM-P1-AI`, `DEC-CRM-P1-SECURITY`, `DEC-CRM-P1-HISTORY` and `DEC-CRM-P1-ACCESSIBILITY` apply.
- Benchmark disposition: adopt the user-value/control pattern while preserving Vercentlabs modular architecture and deterministic authority.

## [SPEC-OMISSION-GATE] Enterprise omission gate
Reviewed hidden expectations: hierarchy cycles, site relationships, merge survivorship, legal identifiers, shared CRM/Sales ownership and sensitive relationship visibility.

The omission challenge explicitly asks whether interactive, import, bulk, automation, integration and AI paths enforce the same rules; whether concurrency/retry can duplicate effects; whether history/reporting remain reproducible; whether mobile/keyboard users can complete the critical job; and whether downstream modules consume only public contracts. No material omission is intentionally left unreviewed for specification readiness.

## [SPEC-SUBCAPABILITIES] Sub-capabilities and capability mapping
- `F002-CAP-001` — The Accounts / companies capability MUST let authorized REP; MGR; OPS; ADMIN users open a company 360, manage relationships and resolve duplicates/hierarchy safely.
- `F002-CAP-002` — The capability MUST include the reviewed enterprise expectations for hierarchy cycles, site relationships, merge survivorship, legal identifiers, shared CRM/Sales ownership and sensitive relationship visibility and MUST NOT treat the short canonical label as the full scope.
- `F002-CAP-003` — Shared party master is consumed by CRM and Sales; cross-module writes must use the owning module public contract.

## [SPEC-FUNCTIONAL] Functional requirements and user stories
- `F002-FR-001` — The system MUST provide a complete server-backed workflow to open a company 360, manage relationships and resolve duplicates/hierarchy safely, including success, empty, validation, permission and conflict states.
- `F002-FR-002` — Every material Accounts / companies mutation MUST leave durable history sufficient to explain actor, time, previous state, new state and reason where applicable.
- `F002-FR-003` — The feature MUST remain usable for individual work and enterprise list/bulk volumes using pagination, virtualization or asynchronous jobs when thresholds are crossed.
- `F002-US-001` — As an authorized front-line user, I can open a company 360, manage relationships and resolve duplicates/hierarchy safely without navigating to raw technical resources or losing related-record context.
- `F002-US-002` — As a manager or operations user, I can inspect, govern and audit Accounts / companies behavior across my permitted team/company scope.

## [SPEC-FLOWS] Primary, alternate, exception, retry and reversal flows
- `F002-FLOW-001` — The primary flow MUST follow the governed lifecycle `PROSPECT -> ACTIVE -> INACTIVE/ARCHIVED; MERGED is represented through merge history and aliases` and expose alternate/cancel paths where the lifecycle permits them.
- `F002-FLOW-002` — Validation failures, authorization denials, concurrency conflicts and retryable integration failures MUST be visible, actionable and safe to retry without duplicate business effects.

## [SPEC-STATE-MACHINE] State machine and transition rules
**Aggregate lifecycle:** `PROSPECT -> ACTIVE -> INACTIVE/ARCHIVED; MERGED is represented through merge history and aliases`.

Commands must declare legal source state, target state, permissions, guards, side effects, audit event and recovery semantics. Derived display states must not silently rewrite authoritative lifecycle facts.

## [SPEC-DATA] Data model, entities, relationships and fields
- `F002-DATA-001` — The authoritative data model MUST explicitly govern business_parties; contacts; crm_account_hierarchy_events; crm_account_merge_history; crm_opportunities with organization identifiers, stable keys, lifecycle timestamps and indexes appropriate to access patterns.
- `F002-DATA-002` — System-derived and externally sourced values MUST retain provenance/lineage, and retention/deletion behavior MUST preserve legally or operationally required audit links.

Primary audited structures: `business_parties; contacts; crm_account_hierarchy_events; crm_account_merge_history; crm_opportunities`. IDs are stable; organization ownership is explicit; related-record references are validated; mutable business records carry concurrency metadata; history/event rows retain lineage.

## [SPEC-VALIDATION] Validation rules
- `F002-VAL-001` — All create/update/transition commands MUST validate required fields, references, organization/company scope, lifecycle legality and normalized input server-side before persistence.
- `F002-VAL-002` — Validation failures MUST return stable CRM error codes plus user-actionable messages without leaking restricted record existence or sensitive values.

## [SPEC-BUSINESS-RULES] Business rules and invariants
- `F002-BR-001` — The owning CRM domain command/service is authoritative for Accounts / companies; UI, import, bulk, automation and AI paths MUST reuse the same business rules.
- `F002-BR-002` — Configuration or later edits MUST NOT rewrite historical Accounts / companies events needed for audit, reporting or reproducibility.

## [SPEC-CALCULATIONS] Calculations, precision and rounding
- `F002-CALC-001` — Hierarchy depth, relationship counts and account activity recency are derived; legal/commercial values remain source-record facts.

## [SPEC-VIEWS] Required view archetypes
- `F002-UX-001` — The primary Accounts / companies workspace MUST expose the next meaningful action above the fold and keep high-frequency context/actions within one consistent CRM shell.
- `F002-UX-002` — List/detail/create/edit surfaces MUST specify loading, empty, error, permission, stale/conflict and destructive-action states with immediate progress/confirmation feedback.
- `F002-UX-003` — Critical Accounts / companies actions MUST work on desktop, tablet and phone with full keyboard operation, visible focus, semantic labels, non-drag alternatives and no horizontal content loss except intentional boards/tables.

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
Bulk behavior is governed by F029. When Accounts / companies participates, each record is re-authorized and validated through the normal domain command; selection may be explicit IDs or a stable filter snapshot; partial results are reported rather than silently ignored.

## [SPEC-ACTIONS] Primary, secondary, contextual and destructive actions
Primary action: open a company 360, manage relationships and resolve duplicates/hierarchy safely. Secondary/destructive actions are available only when state + permission + scope permit them. Destructive/irreversible operations require explicit confirmation/reason where applicable and have keyboard/mobile equivalents.

## [SPEC-RELATED] Related records and contextual navigation
Related records are queried through authorized relationships around `business_parties; contacts; crm_account_hierarchy_events; crm_account_merge_history; crm_opportunities`. Create-from-context pre-fills only safe references; counts/previews cannot reveal inaccessible child records; deep links preserve tenant/company context.

## [SPEC-AUTOMATION] Automation and workflow engine behavior
- `F002-AUTO-001` — Approved automation may act on Accounts / companies only through normal domain commands with trigger provenance, recursion control, retry policy, audit and operator visibility.

## [SPEC-APPROVALS] Approvals, maker-checker and segregation of duties
- `F002-APP-001` — Ordinary low-risk Accounts / companies work does not require a universal approval; elevated overrides, destructive merges, high-impact bulk changes or configured thresholds MUST require the explicit permission/approval policy and reason.

## [SPEC-NOTIFICATIONS] Notifications and communication behavior
- `F002-NOTIF-001` — Notifications for Accounts / companies MUST be event-driven, permission-safe, preference-aware, deduplicated on retry and include a durable deep link when the recipient remains authorized.

## [SPEC-DOCUMENTS] Attachments, generated documents, print and templates
Where files/generated documents apply, parent-record authorization is inherited, storage keys are server-owned, MIME/content and malware checks precede READY state, and retention/versioning is explicit. If the feature has no native document, this contract applies only to related attachments and no extra document type is invented.

## [SPEC-IMPORT-EXPORT] Import, export and migration behavior
F021 governs lead import/export. For Accounts / companies, any generic import/export path must reuse server validation, duplicate/record-scope rules and audit. Exports apply row/field/content authorization before materialization; large operations are asynchronous and produce a result manifest.

## [SPEC-REPORTING] Reports, KPIs, analytics and drilldown
- `F002-REP-001` — Reports/KPIs for Accounts / companies MUST define formula, dimensions, time basis, freshness, currency/units where applicable, permission-safe aggregation and drill-down reconciliation.

## [SPEC-AI] AI opportunities, authority boundary and safeguards
- `F002-AI-001` — AI class is `AI_ASSIST`. AI MAY assist/recommend/generate only within the caller's normal data permissions and MUST expose provenance, model/version, uncertainty/reasons where applicable and a deterministic/human fallback; it MUST NOT bypass normal mutation authority.

Decision: `AI_ASSIST`. Deterministic authorization/state/calculation rules remain authoritative.

## [SPEC-SECURITY] Security, permissions and field controls
- `F002-SEC-001` — Every Accounts / companies query and command MUST enforce server-side organization, company/branch where applicable, team/owner/record scope and action permission before returning or mutating data.
- `F002-SEC-002` — Sensitive fields/content MUST support stricter field/content visibility than record visibility, and negative tests MUST prove unauthorized users cannot infer data via search counts, reports, timeline, exports, AI or errors.

## [SPEC-SCOPE] Tenant, company, branch, team, owner and record scope
All reads/writes are organization-scoped; company/branch/location scope applies where the record model uses it; team/territory/owner/record scope composes with action permissions. Cross-company exceptions require an explicit authorized contract, never an omitted predicate.

## [SPEC-AUDIT] Auditability and history
Material mutations record actor/service identity, channel, timestamp, reason where required, before/after or event payload, request/correlation ID and links to approval/reversal/downstream result. Operator-visible history must be consistent with tamper-resistant backend audit evidence.

## [SPEC-CONCURRENCY] Concurrency and conflict handling
Mutable aggregates use optimistic version/updated-at preconditions. Stale writes fail with a conflict code and recoverable UI. Multi-row allocation/merge/conversion/forecast/bulk operations use the transaction/locking strategy required to preserve invariants and retry deadlocks safely.

## [SPEC-IDEMPOTENCY] Idempotency, retry safety and exactly-once business effects
Non-repeatable commands (conversion, merge, provider webhook/sync, bulk job creation, downstream handoff) require idempotency identity and replay/no-op semantics. Outbox/worker effects are at-least-once technically but exactly-once at the business effect through deduplication/reconciliation.

## [SPEC-INTEGRATIONS] Cross-module and external integrations
- `F002-INT-001` — Shared party master is consumed by CRM and Sales; cross-module writes must use the owning module public contract.
- `F002-INT-002` — Every external or cross-module effect for Accounts / companies MUST define idempotency, retry ownership, failure visibility, compensation/reversal where possible and an operator reconciliation path.

## [SPEC-API] Commands, queries and API contracts
- `F002-API-001` — Mutating Accounts / companies APIs MUST have explicit request/response/error schemas, authorization, optimistic concurrency where records are editable, audit/correlation metadata and idempotency for non-repeatable commands.
- `F002-API-002` — Accounts / companies list/search/detail APIs MUST use bounded pagination, stable sorting/filter semantics, permission-safe counts and compatibility/versioning rules.

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
- `F002-PERF-001` — Normal Accounts / companies record reads SHOULD meet p95 <=400ms server response, filtered lists <=600ms and standard mutations <=750ms on representative datasets; large jobs MUST become asynchronous.

## [SPEC-OBSERVABILITY] Logs, metrics, traces, jobs and support diagnostics
- `F002-OBS-001` — The system MUST emit correlation IDs, structured non-PII logs, business/technical metrics and retry/dead-letter/reconciliation diagnostics sufficient to explain Accounts / companies failures without exposing sensitive content.

## [SPEC-EDGE-CASES] Edge cases, abuse cases and recovery
Cover empty/min/max values, Unicode/long text, stale references, duplicates, concurrent actors, deactivated configuration, timezone/DST where temporal, permission changes mid-session, partial provider/outbox failure, retry storms, deleted/merged related records and attempts to use import/bulk/AI as an authorization bypass.

## [SPEC-CODE-AUDIT] Current-code evidence audit
Verified code evidence: `CRM-P1-CODE-002` at `apps/web/src/modules/crm/components/accounts-workspace.tsx`.

Finding: Dedicated account workspace, hierarchy/merge APIs and customer-360 surfaces exist; shared party ownership still requires explicit governance.

Interpretation: presence of code is implementation evidence only. Target requirements are not weakened to match the current implementation.

## [SPEC-GAPS] Exact gap analysis
Pass 1 gap class: existing implementation must be mapped/tested requirement-by-requirement against this target, especially hierarchy cycles, site relationships, merge survivorship, legal identifiers, shared CRM/Sales ownership and sensitive relationship visibility. Any absent/partial behavior becomes an implementation backlog item later; this dossier does not claim the code is already complete.

## [SPEC-IMPLEMENTATION] Implementation map and dependency order
Likely implementation areas include the audited path `apps/web/src/modules/crm/components/accounts-workspace.tsx`, CRM module/domain services, tenant migrations/data contracts, shared CRM workspace primitives, mobile where high-frequency, and tests. Sequence: preserve public contracts -> close data/state/security gaps -> UI/automation/integration -> tests/E2E/performance/UAT. No product source code is modified by this specification pass.

## [SPEC-TESTS] Automated test plan
Unit/domain tests cover invariants and calculations; database tests cover constraints/RLS where applicable; API tests cover schemas/authorization/concurrency/idempotency; integration tests cover retries/outbox/providers; performance tests cover representative volume; migration tests prove historical compatibility and reconciliation.

## [SPEC-E2E] Browser and critical-journey E2E
- `F002-E2E-001` — Browser E2E MUST prove an authorized user can open a company 360, manage relationships and resolve duplicates/hierarchy safely and an unauthorized user cannot perform or infer the same action/data.
- `F002-E2E-002` — Browser/API E2E MUST prove stale-write/conflict or retryable failure behavior for Accounts / companies is visible, recoverable and does not duplicate business effects.

## [SPEC-UAT] Human UAT plan
- `F002-UAT-001` — Human UAT MUST have a front-line persona execute the primary Accounts / companies job on desktop and a high-frequency mobile/tablet path, capturing visible result and audit evidence.
- `F002-UAT-002` — Human UAT MUST have a manager/operations persona exercise one permission/exception/override or reconciliation case and confirm reporting/history reflect the outcome.

## [SPEC-DOD] Objective Definition of Done
Specification DoD is satisfied when all materialized `F002-*` requirements are approved, both benchmark evidence rows and verified code audit exist, 54 sections are complete, omission review has no unresolved material placeholder, visual/API/security/test/UAT contracts are present, and validators pass. Product DoD is explicitly **not** satisfied by this pass.

## [SPEC-OPEN-DECISIONS] Open decisions, assumptions and risks
No material specification blocker remains. Implementation-time choices (exact component composition, migration mechanics, provider adapters and measured performance tuning) must remain within these contracts and be recorded as new decision IDs if they change behavior. Sales F036 is not pre-certified; only the CRM side of F023's public handoff is fixed here.

## [PASS-B-SEMANTIC-FREEZE]

Status: `APPROVED` — Final Pass B semantic/sub-feature review.

The canonical F-ID remains unchanged. The following mandatory enterprise semantic scopes are owned by this dossier and must be represented by implementation/test evidence before `FEATURE_READY`:

- `F002-SEM-01` — **Feature-specific lifecycle and operator outcome**: Freeze entry conditions, valid states/actions, terminal outcomes and explicit non-goals for this feature.
- `F002-SEM-02` — **Authoritative data, relationships and historical truth**: Define identifiers, required/optional fields, references, effective dates, lineage, retention and immutable historical facts.
- `F002-SEM-03` — **Eligibility, validation, precedence and invariant rules**: Specify server-side guards, configuration precedence, deterministic decisions and actionable failure messages.
- `F002-SEM-04` — **Role, scope, sensitive field and override authority**: Define permissions, tenant/company/branch/team/owner scope, field visibility and privileged override audit.
- `F002-SEM-05` — **Primary/alternate/exception operator workflow**: Cover list/search/detail/create/edit/actions, bulk behavior, empty/error/conflict states, responsive/mobile applicability and accessibility.
- `F002-SEM-06` — **Cross-module/external ownership and contract boundaries**: Identify authoritative owner, public commands/queries, event/outbox effects, idempotency and reconciliation.
- `F002-SEM-07` — **Concurrency, duplicate, retry, cancellation and recovery**: Define stale writes, duplicate submissions, retries, partial integration failure, reversal/compensation and exception queues.
- `F002-SEM-08` — **Audit, observability, automated tests and UAT**: Require auditable state changes, metrics/logs, negative/concurrency/integration tests, E2E and human sign-off.

Cross-module context: **Sales;Support / Customer Service**.
Shared-platform dependencies: `SP008;SP009;SP014;SP015;SP017;SP018;SP020;SP021;SP023;SP024;SP030;SP033;SP036`.

Pass B decision: **no new canonical F-ID required**; mature behavior expands this feature dossier rather than fragmenting the F001–F510 register.
