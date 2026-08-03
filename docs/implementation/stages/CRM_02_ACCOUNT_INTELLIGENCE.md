# CRM-02 — Account intelligence, Customer 360 and privacy execution

## Purpose

CRM-02 completes five customer and data-governance capabilities: `CRM-027`, `CRM-028`, `CRM-029`, `CRM-030` and `CRM-035`. The stage extends the existing account/contact foundation rather than introducing a second CRM data model.

## Capability scope

- Cycle-protected account hierarchy and immutable hierarchy-change history.
- Customer 360 across CRM activities and communications, opportunities, quotations, sales orders, customer invoices, receipts and governed support-event ingestion.
- Weighted account duplicate discovery and transactional account merge.
- Normalised contact duplicate discovery and transactional contact merge.
- Privacy-request preview and execution, legal-hold protection, anonymisation, erasure marking and automated retention policies.

## Merge guarantees

Merges lock both candidates, remain organisation scoped, preserve immutable source and survivor snapshots, create stable source-to-survivor aliases and move tenant foreign-key references transactionally. Parent-to-descendant account merges are rejected to prevent hierarchy collapse. Unique relationship conflicts fail closed and require explicit resolution instead of silently dropping data.

## Privacy boundary

Anonymisation and erasure redact personal fields while retaining the minimum non-personal transaction shell required for accounting, audit and statutory integrity. Identity verification, terminal request states and legal holds block execution. Automated retention supports governed restriction or anonymisation; destructive erasure remains an explicit privacy-request action.

## Support boundary

The Support module is not yet available. Customer 360 therefore includes support context through `crm_customer_service_events`, a tenant-isolated ingestion contract for manual or external service/case systems. This does not claim completion of the future Support module.

## Migration

`029_crm_account_intelligence_privacy.sql` adds hierarchy/privacy fields, tenant-safe foreign keys, cycle protection, forced-RLS operational tables, immutable execution/acceptance evidence and inactive default retention policies.

## Gates

```bash
pnpm verify:crm-02
pnpm test:crm-02-live
pnpm verify:crm-02-complete
```

The transactional live gate verifies hierarchy safety, Customer 360 source coverage, account/contact merge movement, anonymisation, erasure, automated retention, immutable acceptance evidence and forced row-level security.
