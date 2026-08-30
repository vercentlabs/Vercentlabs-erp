# CRM Pass 1 Current-Code Audit

Research date: 2026-08-30

The pass verifies at least one concrete current-code artifact for every F001–F030 and stores it in `EVIDENCE_REGISTER.csv` as `CRM-P1-CODE-001`…`030`. Existing code is treated as evidence to reconcile against the specification, not as proof of completion.

- **F001 Leads** — `apps/web/src/modules/crm/components/leads-workspace.tsx` — Dedicated lead workspace exists with server-backed search/filtering, saved views and lifecycle actions; code is evidence, not certification.
- **F002 Accounts / companies** — `apps/web/src/modules/crm/components/accounts-workspace.tsx` — Dedicated account workspace, hierarchy/merge APIs and customer-360 surfaces exist; shared party ownership still requires explicit governance.
- **F003 Contacts** — `apps/web/src/modules/crm/components/contacts-workspace.tsx` — Dedicated contact list/detail/create-edit workflows and duplicate/merge APIs exist; privacy and content-level visibility remain specification controls.
- **F004 Lead sources** — `apps/web/src/modules/crm/components/lead-sources-workspace.tsx` — Dedicated lead-source administration workspace and API validation exist; source provenance must be governed across conversion/reporting.
- **F005 Lead assignment** — `apps/web/src/modules/crm/components/lead-assignment-rules-workspace.tsx` — Assignment policy/workspace and governed lead assignment APIs exist, including rule and round-robin foundations.
- **F006 Lead qualification** — `apps/web/src/modules/crm/components/lead-qualification-card.tsx` — Lead qualification card, API and domain service exist; specification separates qualification authority from scoring.
- **F007 Lead stages and statuses** — `apps/web/src/modules/crm/components/lead-lifecycle-workspace.tsx` — Lead lifecycle workspace and stage transition APIs exist with history/governance foundations.
- **F008 Duplicate detection** — `apps/web/src/app/api/crm/leads/duplicates/route.ts` — Lead/account/contact duplicate endpoints and merge services exist; survivorship and precision remain explicit specification requirements.
- **F009 Opportunities** — `apps/web/src/app/(app)/crm/opportunities/[id]/page.tsx` — Opportunity detail workspace, stage/probability commands and supporting domain services exist; downstream quotation remains Sales-owned.
- **F010 Opportunity pipeline** — `apps/web/src/modules/crm/components/pipeline-board.tsx` — Responsive pipeline board and governed stage movement exist, including keyboard/native alternatives and optimistic concurrency patterns.
- **F011 Probability and expected revenue** — `apps/web/src/modules/crm/components/opportunity-probability-action.tsx` — Probability action and revenue-intelligence services exist with history and calculation foundations.
- **F012 Sales stages** — `apps/web/src/modules/crm/components/sales-stages-workspace.tsx` — Dedicated stage configuration workspace and stage APIs exist; live-pipeline change semantics need formal governance.
- **F013 Calls** — `apps/web/src/modules/crm/components/calls-workspace.tsx` — Dedicated calls workspace and start/complete/cancel API lifecycle exist.
- **F014 Meetings** — `apps/web/src/modules/crm/components/meetings-workspace.tsx` — Meeting workspace, lifecycle APIs and public meeting booking endpoints exist.
- **F015 Tasks** — `services/api/src/modules/crm/task-operations.js` — Task domain operations and start/cancel/history endpoints exist; explicit F015 certification was weaker than earlier F-IDs in prior targeted naming.
- **F016 Follow-ups and reminders** — `apps/web/src/app/api/crm/leads/[id]/follow-up/route.ts` — Lead follow-up API exists and activity infrastructure can support generalized reminders; channel semantics need explicit specification.
- **F017 Notes and attachments** — `apps/web/src/app/api/crm/leads/[id]/notes/route.ts` — Lead notes and attachment routes exist; security scanning, privacy classes and shared attachment service behavior remain explicit design requirements.
- **F018 Email history** — `services/api/src/modules/crm/communications.js` — CRM communications service includes send/sync/inbox/webhook/timeline capabilities; sensitive email content needs finer authorization than record visibility alone.
- **F019 Activity timeline** — `apps/web/src/app/api/crm/communications/timeline/route.ts` — Timeline endpoint and detail-data aggregation exist; unified ordering and per-item visibility must be certified.
- **F020 Territories and sales teams** — `database/tenant/migrations/003_crm_enterprise_core.sql` — Enterprise CRM migration defines sales teams and territories; operator-facing governance and hierarchy semantics need formal specification.
- **F021 Lead import and export** — `apps/web/src/app/api/crm/[resource]/import/route.ts` — Generic CRM import/export routes and acquisition import infrastructure exist; pass must define safe mapping, async jobs and row-level results.
- **F022 Lead-to-opportunity conversion** — `apps/web/src/app/api/crm/leads/[id]/convert/route.ts` — Lead conversion endpoint and conversion records exist; field mapping, existing/new resolution and retry idempotency must be explicit.
- **F023 Opportunity-to-quotation conversion** — `apps/web/src/app/(app)/crm/opportunities/[id]/page.tsx` — Opportunity detail already exposes a permission-guarded Sales quotation handoff, matching the intended module boundary.
- **F024 Pipeline dashboard** — `apps/web/src/app/api/crm/dashboard/route.ts` — CRM dashboard API and page infrastructure exist; KPI formulas and authorization-safe aggregation need formal contracts.
- **F025 Sales forecast** — `apps/web/src/app/(app)/crm/forecast/page.tsx` — Forecast page and enterprise forecast tables exist; reproducible snapshots, hierarchy and adjustment semantics require certification.
- **F026 Won / lost reasons** — `database/tenant/migrations/056_crm_f001_f030_outcome_reasons.sql` — Dedicated outcome-reason migration and pipeline close support exist; catalogue version/history semantics need specification.
- **F027 Basic lead scoring** — `apps/web/src/app/api/crm/leads/[id]/score/route.ts` — Lead score endpoints and intelligence services exist with scoring tables; deterministic model governance and ML separation remain requirements.
- **F028 Custom fields and tags** — `apps/web/src/app/api/crm/leads/[id]/custom-fields/route.ts` — Custom-field and tag APIs/tables exist; typed lifecycle, indexing and field-level access need formal contracts.
- **F029 Bulk actions** — `apps/web/src/app/api/crm/leads/operations/route.ts` — Lead and opportunity operations endpoints exist; standard async job semantics and dangerous-action controls need specification.
- **F030 CRM reports** — `apps/web/src/app/(app)/crm/reports/page.tsx` — Reports page, report API and report-definition tables exist; semantic metric governance and security reconciliation need specification.
