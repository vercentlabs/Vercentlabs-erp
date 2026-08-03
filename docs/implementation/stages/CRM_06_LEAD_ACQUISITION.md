# CRM-06 — Lead acquisition, forms and enrichment

CRM-06 closes capabilities CRM-054, CRM-056, CRM-057, CRM-058, CRM-059 and CRM-063.

## Delivered controls

- Preview-first bulk imports with explicit field mappings and row-level errors.
- Duplicate strategies (`skip`, `block`, `update`, `create`) and guarded rollback.
- Versioned capture-form definitions, publishing, origin controls, consent evidence and honeypot support.
- Provider-neutral advertising and social connectors with timestamp-bound signed webhooks and idempotent events.
- Public website-chat sessions with governed message history.
- Lead provenance and multi-touch attribution evidence.
- Reviewable enrichment proposals; providers cannot silently overwrite lead data.
- Tenant-scoped dashboards, mobile parity and immutable acceptance evidence.

## Production boundary

Local and staging acceptance uses mock/sandbox providers. Google Ads, Meta, LinkedIn, social and enrichment connections require separately configured credentials, publicly reachable webhook endpoints, provider policy approval and production acceptance evidence before promotion.
