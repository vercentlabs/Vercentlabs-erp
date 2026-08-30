# CRM Pass 1 Reference Architecture

## Request/authorization chain
`authentication -> organization -> module entitlement -> role/action permission -> company/branch -> team/owner/record scope -> field/content scope -> business rule -> transaction -> audit/outbox`

## Domain ownership
- Prospect/master data: leads, accounts/companies, contacts, sources and duplicate governance.
- Lifecycle/prioritization: assignment, qualification, stages, scoring.
- Opportunity: opportunity aggregate, pipeline/stages, probability and close outcomes.
- Activity: calls, meetings, tasks, follow-ups, notes/files, email and normalized timeline.
- Organization: sales teams and territories.
- Data operations: import/export, customization and bulk jobs.
- Analytics: dashboard, forecast and reports.
- Cross-module: lead conversion stays CRM; quotation creation is Sales-owned.

## Concurrency/idempotency
Editable aggregates use optimistic concurrency. Conversion, merge, bulk jobs, webhook ingestion, provider synchronization and opportunity-to-quotation handoff use explicit idempotency/replay semantics.

## AI
AI reads inherit normal row/field/content permissions. AI mutations must invoke the same normal commands and approval policies as human/automation paths.
