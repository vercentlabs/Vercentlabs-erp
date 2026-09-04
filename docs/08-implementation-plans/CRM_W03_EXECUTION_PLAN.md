# CRM W03 — accelerated implementation plan

Status: **RECONCILIATION_REQUIRED**

> Governance transition: this plan predates the live AWP register. Its batches remain useful capability groupings, but they do not authorize new edits. After parallel-governance tooling is installed and execution-state reconciliation is complete, each executable unit must be registered as one or more conflict-free AWPs.

## Canonical wave naming

The frozen repository implementation-wave register is authoritative for Wxx labels:

- `T00` — technical safety foundation
- `T01` — shared platform + experience kernel
- `W01` — master-data foundation
- `W02` — accounting + inventory primitives
- `W03` — CRM (`F001–F030`)
- `W04` — Sales (`F031–F062`)
- `W05` — Procurement + Stock (`F063–F144`)
- `W06` — Finance integration (`F453–F510` plus subledger integration)

Older noncanonical conversation/document shorthand is historical only. New implementation evidence must use `W03`.

## Why the execution model changed

F001 exposed a process problem: splitting one feature into many named micro-passes created coordination and rerun overhead even when the engineering work belonged to one acceptance boundary. The quality bar does not change, but the unit of delivery does.

A feature or batch now has only two externally visible states:

1. **Implementation candidate** — code, schema, UI, authorization, integration and automated regression work is present.
2. **Certified** — the candidate has passed the required static, database, package, release, live-performance/concurrency and UAT evidence for its risk class.

Internal investigation steps are not promoted to separate “passes”. A separate pass is justified only for a truly independent migration/security boundary that cannot safely ship in the same candidate.

## W03 delivery batches

### Batch A — Lead and relationship foundation (`F001–F008`)

- F001 Leads
- F002 Accounts / companies
- F003 Contacts
- F004 Lead sources
- F005 Lead assignment
- F006 Lead qualification
- F007 Lead stages and statuses
- F008 Duplicate detection

F001 is finalized first because it is the primary composition surface. F002–F008 are then audited and closed as one dependency-aware batch rather than eight isolated multi-pass projects.

### Batch B — opportunity and execution core (`F009–F018`)

- F009 Opportunities
- F010 Opportunity pipeline
- F011 Probability and expected revenue
- F012 Sales stages
- F013 Calls
- F014 Meetings
- F015 Tasks
- F016 Follow-ups and reminders
- F017 Notes and attachments
- F018 Email history

### Batch C — CRM completion (`F019–F030`)

- F019 Activity timeline
- F020 Territories and sales teams
- F021 Lead import and export
- F022 Lead-to-opportunity conversion
- F023 Opportunity-to-quotation conversion
- F024 Pipeline dashboard
- F025 Sales forecast
- F026 Won / lost reasons
- F027 Basic lead scoring
- F028 Custom fields and tags
- F029 Bulk actions
- F030 CRM reports

## Certification discipline

A batch is not certified by UI presence or passing unit tests alone. Certification still requires, where applicable:

- server-side authorization and record/field scope;
- valid lifecycle/state transitions and optimistic concurrency;
- idempotent non-repeatable commands and retry-safe worker/outbox effects;
- audit/history and actionable errors;
- responsive/accessibility behavior;
- package/API/Web/worker regression suites;
- database migration/RLS/structure validation;
- representative live performance and concurrency evidence for scale-sensitive paths;
- browser/API E2E for critical journeys;
- human UAT for the personas called out by the feature specifications;
- full repository `release:verify` before final readiness/register updates.

The acceleration comes from **larger coherent delivery units and fewer reruns**, not from deleting acceptance criteria.
