# CRM lead management (CRM-CAP-002)

Path: `services/api/src/modules/crm/lead-management/`

Owns F005 Lead assignment, F006 Lead qualification, F007 Lead stages and statuses and F027 Basic lead scoring: explainable routing, qualification, lifecycle governance and prioritization.

Main files: `lead-record-rules.js` (the Lead rules applied by the generic record commands: create/update/archive guards, duplicates, assignment, scoring, consent log), `lead-operations.js`, `lead-governance.js`, `lead-security.js` (lead field projection, used across CRM), `lead-qualification.js` (the governed decision workflow), `qualification-fields.js` (decision-field guard and readiness field allowlist, used by the generic record kernel without depending on the workflow), `lead-assignment.js`, `lead-intelligence.js` (SLA, nurture queue), `assignment/`, `lifecycle/`, `scoring/`.

Depends on: `data-management` (shared record infrastructure), `sales-organization` (territory matching), `master-data` (lead source validation).

## Boundary

Everything in this directory is private to the CRM module. Other modules, orchestration, the web app and the worker reach it only through `services/api/src/modules/crm/index.js` (enforced for other modules by `scripts/validation/verify-architecture.mjs`). Inside the CRM module, import the owning capability file directly, never `../index.js` (enforced by `checkCrmSelfBoundaryImports` in `scripts/validation/architecture-rules.mjs`). Note that `services/api/src/index.js` still re-exports several files from here directly; that broad surface is pinned by `services/api/tests/crm-public-api-exports.test.mjs` until a later pass narrows it.
