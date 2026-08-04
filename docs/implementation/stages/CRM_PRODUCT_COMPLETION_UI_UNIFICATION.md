# CRM Product Completion and UI Unification

This remediation pass converts the advanced CRM workspaces from read-only readiness dashboards into operational workspaces while preserving the existing backend services.

## Product outcomes

- The legacy `module-workbench crm-workbench` experience is the canonical CRM shell.
- Ten advanced CRM workspaces expose governed actions, clear metrics, lists and non-blank access-denied states.
- CRM-specific styling is scoped under `.crm-product-shell`; it does not redefine global design tokens.
- Telephony, transcription and provider-sync queues have a real supervised worker with bounded retries, dead-letter states and immutable provider receipts.
- The optional AI provider path is HTTPS-only, grounded, redacted and human-approval-required.
- CRM evidence validation checks that every declared implementation and test path exists.
- Acceptance is separated into local, sandbox, staging and production tiers. Local mocks cannot satisfy production provider acceptance.

## Acceptance dimensions

Backend, web UI, mobile UI, automated tests, tenant security, provider execution, browser acceptance and business acceptance are recorded separately. Production promotion remains blocked until all applicable dimensions have signed evidence matching the release SHA.

## Migration sequencing

Applied migrations are not renamed. The historical duplicate `039` prefix is explicitly detected, documented and tolerated as a known legacy condition. This pass uses migration `042_crm_product_acceptance.sql`; any future duplicate prefix fails the verifier.
