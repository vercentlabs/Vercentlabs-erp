# W03 / F001 — Governance & Intelligence Candidate Manifest

Historical internal label: `F001 Pass 2B` — implementation evidence label only; not a Specification Pass and not an implementation wave.
Status: **CANDIDATE IMPLEMENTATION**

## Objective

Close the Lead 360 governance/intelligence acceptance surface without weakening the F001 record-scope and sensitive-content boundary established in Pass 2A.

## Reused enterprise capabilities

Pass 2B deliberately reuses the existing tenant data model and services. No new database migration is required for this candidate.

- `tenant.crm_lead_provenance` — acquisition provenance and attribution evidence.
- `tenant.crm_consent_events` — immutable consent/lawful-basis evidence.
- `tenant.crm_enrichment_jobs` + `tenant.crm_enrichment_reviews` — human-reviewed enrichment workflow.
- `tenant.crm_lead_sla_policies` + `tenant.crm_lead_sla_cases` + `tenant.crm_lead_sla_events` — first-response SLA state and audit evidence.
- `tenant.crm_data_quality_scores` — current Lead data-quality signal.
- Lead `score_explanation` + score snapshots/history — deterministic explainability.
- `tenant.crm_ai_predictions` — model/provider/version-labelled AI evidence.

## Security corrections included

1. Lead enrichment queue/review now requires `crm.leads.view_sensitive` (or organization-owner authority) inside the service, not only a data-quality permission at the route.
2. Lead enrichment queue/review resolves the referenced Lead through active company, active branch and owner/view-all record scope before queueing or applying changes.
3. Enrichment review re-checks the scoped Lead while the review is locked, preventing known-review-id mutation of an inaccessible Lead.
4. The enrichment mutation route now uses same-origin protection and the shared bounded JSON reader.
5. Generic Lead-linked consent-event list/create access now inherits the sensitive Lead boundary and Lead company/branch/owner scope.
6. Lead consent events remain immutable after creation.
7. Lead 360 provenance deliberately excludes `original_payload`; the UI receives only the evidence needed for provenance inspection.

## Lead 360 surfaces added

The full-page and drawer Lead 360 now share a `Governance & AI` section containing:

- source/provenance history with provider, source channel, attribution reference and content hash;
- privacy-manager-only immutable consent-event history and event recording;
- first-response SLA policy/status/due date, event history, start tracking and record-response actions;
- data-quality-manager-only overall/completeness/validity/freshness/duplicate-risk signal;
- human enrichment review with per-field selection, partial acceptance and reject-all workflow;
- deterministic score model/name/version, contribution breakdown and recalculation;
- AI prediction evidence with prediction type, label/score, explanation, provider, model name and model version.

Restricted Lead users continue to receive only the non-sensitive Lead 360 tabs. Privacy/data-quality/AI evidence is independently permission-gated rather than inferred from ordinary Lead access.

## Files changed

- `services/api/src/modules/crm/lead-acquisition.js`
- `services/api/src/modules/crm/index.js`
- `services/api/tests/crm-leads-f001-pass2b.test.mjs`
- `apps/web/src/app/api/crm/lead-acquisition/enrichment/route.ts`
- `apps/web/src/modules/crm/server/lead-detail-data.ts`
- `apps/web/src/modules/crm/components/lead-detail-workspace.tsx`
- `apps/web/src/modules/crm/components/resource-manager.tsx`
- `apps/web/src/app/(app)/crm/leads/[id]/page.tsx`
- `apps/web/src/app/(app)/crm/[resource]/page.tsx`
- `apps/web/tests/crm-leads-f001-pass2b.test.mjs`
- `docs/08-implementation-plans/W03_F001_LEADS_IMPLEMENTATION.md`
- this manifest.

## Focused verification in the source snapshot

- JavaScript syntax checks for modified API modules: **PASS**.
- TypeScript/TSX parser checks for modified Web files: **PASS**.
- focused F001 Pass 2B API/service regressions: **4/4 passed**.
- focused F001 Pass 2B Web regressions: **4/4 passed**.
- combined Pass 2A + Pass 2B API/service regressions: **16/16 passed**.
- combined Pass 2A + Pass 2B Web regressions: **11/11 passed**.
- database structure validator: **PASS — 34 platform + 73 tenant migrations, 0 failures, 0 warnings** (static structure analysis).
- architecture/import/deployment/document-path validator: **PASS**.

The source archive does not contain installed workspace dependencies, is running Node 22 rather than the repository-required Node 24, and Corepack cannot fetch the pinned pnpm package in this sandbox. Therefore full package tests, Web typecheck/lint/build and repository/release gates cannot be claimed from the archive environment. The guarded installer must run those gates in the actual repository after dependency/toolchain activation.

## Acceptance still required

Pass 2B remains a candidate until the actual repository successfully runs:

1. `corepack pnpm verify:db`
2. focused Pass 2A + Pass 2B regressions
3. `corepack pnpm test:api`
4. `corepack pnpm test:web`
5. `corepack pnpm typecheck:web`
6. `corepack pnpm lint:web`
7. `corepack pnpm verify`
8. `corepack pnpm release:verify`

Pass 2C large-volume bulk/performance evidence and Pass 2D browser/PostgreSQL/UAT evidence remain separate acceptance gates. This manifest does **not** mark F001 complete.
