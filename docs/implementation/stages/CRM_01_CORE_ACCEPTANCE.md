# CRM-01 — Core CRM completion and executable acceptance

## Purpose

CRM-01 closes the evidence and acceptance gap for the 17 core CRM capabilities already implemented in the product register: `CRM-010` through `CRM-026`. It does not claim completion for provider-dependent communications, telephony, marketing, AI, partner portal or advanced mobile capabilities scheduled for later CRM stages.

## Accepted capability scope

- Account plans and stakeholder maps.
- Accounts, contacts and addresses.
- Activities, reminders and recurring activities.
- Buying committees and relationship mapping.
- CRM data-quality scores.
- Campaigns and source attribution.
- Competitor tracking.
- Consent, do-not-contact and privacy requests.
- Duplicate detection and lead merge.
- Forecast submissions and pipeline inspections.
- Lead assignment and round robin.
- Lead capture and lead master.
- Lead conversion.
- Lead scoring.
- Opportunity and pipeline management.
- Playbooks and stage-exit questions.
- Sales teams, territories and quotas.

## Acceptance model

The stage introduces organisation-scoped acceptance runs and immutable snapshots. The gate requires all 17 capability checks plus seven cross-surface checks covering web, mobile, API, database, tenant isolation, security and a live workflow. Missing, skipped or failed checks block readiness. Warning checks prevent a fully ready result.

## Evidence boundary

Evidence ledger rows for `CRM-010` through `CRM-026` are populated only with paths that exist in the repository. Acceptance is recorded by the CRM-01 transactional live gate. This is local/staging technical acceptance; production promotion remains subject to Stage 11 deployment, restore, monitoring and business-owner acceptance requirements.

## Migration

`028_crm_core_acceptance.sql` creates two forced-RLS tables:

- `crm_core_acceptance_runs`
- `crm_core_acceptance_snapshots`

## Gates

```bash
pnpm verify:crm-01
pnpm verify:crm-01-complete
pnpm test:crm-01-live
```
