# CRM master data (CRM-CAP-001)

Path: `services/api/src/modules/crm/master-data/`

Owns F001 Leads, F002 Accounts/companies, F003 Contacts, F004 Lead sources and F008 Duplicate detection: trusted prospect, company and contact identity, provenance and data quality.

Main files: `account-operations.js`, `accounts/` (`account-hierarchy.js`, `customer-360.js`), `merge/record-merge.js` (governed Account and Contact merge), `privacy/` (`privacy-requests.js`, `privacy-retention.js`), `record-access.js` (scoped Account/Contact loaders), `contact-operations.js`, `contact-relationships.js`, `*-security.js` (field projection), `lead-source-*.js`, `lead-attribution.js`, `lead-duplicates.js` / `duplicate-*.js`, `lead-capture.js` (public web-to-lead), `lead-acquisition.js`. F021 lead import and export live in `data-management/import-export/`.

Depends on: `data-management` (errors, record policy, access scope, outbox, generic resources) and `lead-management` (lead security and governance).

`account-intelligence.js` is a compatibility boundary only: it re-exports the names that used to be implemented there (enforced by `checkCrmCompatibilityBarrels`). Its small shared pieces are `account-intelligence-error.js` and `account-intelligence-hash.js` (deliberately local; not interchangeable with other CRM hash helpers); `account-intelligence-acceptance.js` is dormant. Customer 360 reads Sales and Accounting tables directly (see the refactor report); that is known cross-module debt, not a pattern to copy.

## Boundary

Everything in this directory is private to the CRM module. Other modules, orchestration, the web app and the worker reach it only through `services/api/src/modules/crm/index.js` (enforced for other modules by `scripts/validation/verify-architecture.mjs`). Inside the CRM module, import the owning capability file directly, never `../index.js` (enforced by `checkCrmSelfBoundaryImports` in `scripts/validation/architecture-rules.mjs`). Note that `services/api/src/index.js` still re-exports several files from here directly; that broad surface is pinned by `services/api/tests/crm-public-api-exports.test.mjs` until a later pass narrows it.
