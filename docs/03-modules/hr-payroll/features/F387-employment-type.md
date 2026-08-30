# F387 — Employment type

## [SPEC-IDENTITY] Identity and traceability
- Canonical ID: `F387`
- Canonical name: **Employment type**
- Module: **HR & Payroll**
- Specification status: `UNSPECIFIED`
- Implementation status: `NOT_STARTED`
- Product status: `NOT_READY`
- Canonical source: `docs/02-register/FEATURE_REGISTER.csv`

## [SPEC-INTENT] Product intent
TBD during the module specification pass.

## [SPEC-OUTCOMES] Measurable outcomes
Define operator, business, control and system outcomes with measurable acceptance criteria.

## [SPEC-PERSONAS] Personas, jobs to be done and permissions
Define personas, JTBD, role expectations, approval authority and negative-permission cases.

## [SPEC-SCOPE] Scope, non-goals, assumptions and dependencies
Define in-scope behavior, explicit non-goals, assumptions and upstream/downstream dependencies.

## [SPEC-ENTRY-POINTS] Entry points and discoverability
Define navigation, global search/command entry, deep links, related-record entry and contextual creation paths.

## [SPEC-BENCHMARK] Benchmark research
Record evidence IDs from `BENCHMARK_REGISTER.csv`; classify material findings `REQUIRED`, `DIFFERENTIATOR`, or `NOT_APPLICABLE` with rationale.

## [SPEC-OMISSION-GATE] Enterprise omission gate
What would an experienced enterprise operator reasonably expect from **Employment type** that the short canonical name does not explicitly state? Every material omission must be decided, not silently ignored.

## [SPEC-SUBCAPABILITIES] Sub-capabilities
Decompose coherent operator-facing sub-capabilities and map them to the parent module capability architecture.

## [SPEC-FUNCTIONAL] Functional requirements
Use traceable IDs such as `F387-FR-001`. TBD.

## [SPEC-BUSINESS-RULES] Business rules and calculations
Use `F387-BR-###`; define invariants, formulas, precision, rounding, currency/UOM/timezone behavior and effective dating where applicable.

## [SPEC-FLOWS] Primary, alternate, exception, reversal and recovery flows
Model happy path, alternate paths, failures, permission denials, conflict handling, cancellation, reversal/compensation, retry and reconciliation.

## [SPEC-STATE-MACHINE] Domain model and state machine
Define aggregate ownership, entities/value objects, states, transition guards, commands, events, reversible/irreversible transitions and concurrency rules.

## [SPEC-DATA] Data contract
Use `F387-DATA-###`; define fields, keys, relationships, constraints, indexes, lifecycle retention/archive, precision, localization and migration implications.

## [SPEC-VIEWS] Views and information architecture
Define list/table/work queue/board/calendar/Gantt/ledger/dashboard/detail-360 archetypes as applicable, plus columns, search, filters, sort, pagination, saved views and bulk operations.

## [SPEC-UX] Interaction and workflow UX
Use `F387-UX-###`; define create/edit/detail/quick-create/related-record flows and loading, empty, validation, error, conflict, permission and success states.

## [SPEC-RESPONSIVE] Responsive, native and offline behavior
Specify desktop/tablet/mobile layout and interaction changes; native/offline/synchronization behavior where applicable.

## [SPEC-ACCESSIBILITY] Accessibility contract
Define keyboard operation, focus, semantics, accessible names, announcements, contrast/touch targets and WCAG 2.2 AA acceptance intent.

## [SPEC-API] API and service contract
Define public commands/queries, request/response schemas, validation, authorization, error contract, pagination/filter/sort, concurrency, idempotency, audit/outbox effects and compatibility.

## [SPEC-AUTOMATION] Automation and workflow rules
Define deterministic automation triggers/conditions/actions, scheduling, retries, recursion protection and operator visibility.

## [SPEC-APPROVALS] Approvals and segregation of duties
Define maker-checker/approval matrices, thresholds, delegation, escalation, rejection, resubmission, audit and SoD where applicable.

## [SPEC-NOTIFICATIONS] Notifications, documents and communications
Define notification channels/templates/preferences, attachments/documents, print/export/import and business-document generation where applicable.

## [SPEC-REPORTING] Reporting, analytics and KPIs
Define operational metrics, drilldown, dimensions, filters, data freshness, reconciliation and export semantics.

## [SPEC-AI] AI opportunity, authority boundary and safeguards
Decision: `UNASSESSED` from `NO_AI | AI_ASSIST | AI_RECOMMEND | AI_GENERATE | AI_AUTOMATE_WITH_APPROVAL | AI_AUTOMATE`.
Use `F387-AI-###`; define provenance, confidence, permission boundary, human oversight, deterministic authority boundary, fallback, feedback and audit.

## [SPEC-SECURITY] Security, privacy and field/record scope
Use `F387-SEC-###`; define authentication assumptions, organization/company/branch/location/record scope, field controls, sensitive data handling, abuse cases and negative authorization tests.

## [SPEC-AUDIT] Auditability and history
Define auditable actions, actor/channel/time/reason, before-after values where applicable, correlation IDs, approval/reversal links, retention and operator-visible history.

## [SPEC-RELIABILITY] Concurrency, idempotency, recovery and observability
Use `F387-OBS-###`; define transaction boundaries, optimistic/pessimistic concurrency, retry/idempotency keys, outbox/worker behavior, duplicate prevention, metrics/logs/traces, exception queues and reconciliation.

## [SPEC-INTEGRATIONS] Cross-module and external integrations
Use `F387-INT-###`; for each transition define trigger, source owner, destination public command, validation, transaction boundary, idempotency, retry/failure, audit/event, visible state, reversal and reconciliation.

## [SPEC-CODE-AUDIT] Current-code evidence audit
Map exact files/routes/schema/tests and current behavior. Classify implemented/partial/foundation/UI-only/missing defects without changing target requirements to match current code.

## [SPEC-GAPS] Gap analysis and implementation map
Map every target requirement to current evidence and a concrete implementation work item/dependency.

## [SPEC-TESTS] Automated verification plan
Use `F387-E2E-###` for end-to-end requirements; include unit/domain, database/security, API/integration, browser E2E, cross-browser/device, performance/scale and failure/recovery verification.

## [SPEC-UAT] Human UAT plan
Use `F387-UAT-###`; define operator scenario, prerequisites, steps, expected state/data/audit outcomes, visual evidence and sign-off.

## [SPEC-DOD] Objective Definition of Done
All applicable research, requirements, design, domain, security, implementation, integration, E2E, responsive, accessibility, visual and UAT gates have objective evidence; parent capability and critical journeys also pass.

## [SPEC-OPEN-DECISIONS] Open decisions and decision links
TBD. No unresolved material product decision may be hidden inside implementation prose.
