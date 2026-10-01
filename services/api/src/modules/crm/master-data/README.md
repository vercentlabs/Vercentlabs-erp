# CRM master data (CRM-CAP-001)

Path: `services/api/src/modules/crm/master-data/`

Owns F001 Leads, F002 Accounts/companies, F003 Contacts, F004 Lead sources and F008 Duplicate detection: trusted prospect, company and contact identity, provenance and data quality.

Main files: `account-operations.js`, `account-intelligence.js` (hierarchy, merge, Customer 360, privacy), `contact-operations.js`, `contact-relationships.js`, `*-security.js` (field projection), `lead-source-*.js`, `lead-attribution.js`, `lead-duplicates.js` / `duplicate-*.js`, `lead-capture.js` (public web-to-lead), `lead-acquisition.js`. `lead-import.js` and `lead-export.js` (F021) still live here for now.

Depends on: `data-management` (errors, record policy, access scope, outbox, generic resources) and `lead-management` (lead security and governance).

## Boundary

Everything in this directory is private to the CRM module. Other modules, orchestration, the web app and the worker reach it only through `services/api/src/modules/crm/index.js` (enforced for other modules by `scripts/validation/verify-architecture.mjs`). Note that `services/api/src/index.js` still re-exports several files from here directly; that broad surface is pinned by `services/api/tests/crm-public-api-exports.test.mjs` until a later pass narrows it.
