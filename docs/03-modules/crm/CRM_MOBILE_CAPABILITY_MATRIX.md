# CRM mobile capability matrix (F001–F030)

Source of truth in code: `apps/mobile/src/modules/crm/ui/crm-feature-registry.ts`
(every F-ID has a disposition; `apps/mobile/tests/crm-feature-registry.test.mjs`
fails if one is missing or a web deep link points at a page that does not
exist). Offline mutations queue on the device and replay through
`/api/crm/offline-sync` (`crm-data-operations-and-customization/offline-sync.js`):
each carries an idempotency key and the record version it was based on; a
version mismatch is stored as a conflict (`tenant.crm_mobile_conflicts`) for the
user to resolve (keep server / apply mine), never a silent overwrite.

Dispositions: **FULL** (native read and write), **FIELD_OPTIMIZED** (native
high-frequency seller actions), **APPROVAL_ONLY**, **READ_ONLY** (native read),
**WEB_WORKSPACE** (opens the governed web screen), **NOT_APPLICABLE**.

Common rules for every row: lists are server-paged (50 per page, server-side
search, "Load more"), never loaded or rendered in one piece; only the first page
of a list is cached for offline reading; the device cache never holds content
the signed-in user could not load online; the store is encrypted (SQLCipher) and is purged on sign-out and whenever a different user or workspace binds the device (`apps/mobile/src/core/database/database.ts`, `core/auth/auth-provider.tsx`).

| F-ID | Capability | Disposition | Read | Mutation | Offline | Conflict policy | Sensitive data | Navigation |
|---|---|---|---|---|---|---|---|---|
| F001 | Leads | FULL | native list/detail | create, edit | first page cached; create queued | version check → conflict record | email/phone only with `crm.leads.view_sensitive` (server projection) | Leads tab |
| F002 | Accounts | WEB_WORKSPACE | web | web | no | web optimistic concurrency | account sensitive fields per `crm.accounts.view_sensitive` | `/crm/accounts` |
| F003 | Contacts | WEB_WORKSPACE | web | web | no | web optimistic concurrency | contact details per `crm.contacts.view_sensitive` | `/crm/contacts` |
| F004 | Lead sources | WEB_WORKSPACE | web | web (settings) | no | — | none | `/crm/settings/lead-sources` |
| F005 | Lead assignment | WEB_WORKSPACE | web | web (rules) | no | — | none | `/crm/settings/assignment` |
| F006 | Lead qualification | WEB_WORKSPACE | web | web | no | web optimistic concurrency | none | `/crm/settings/playbooks` |
| F007 | Lead lifecycle | WEB_WORKSPACE | web | web (settings) | no | — | none | `/crm/settings/lead-lifecycle` |
| F008 | Duplicate management | WEB_WORKSPACE | web | web (merge) | no | merge re-validates at commit | as record | `/crm/data/duplicates` |
| F009 | Opportunities | FULL | native list/detail | create, edit | first page cached; create queued | version check → conflict record | amounts per record scope | Pipeline tab |
| F010 | Pipeline | FIELD_OPTIMIZED | native board | stage move (non-drag button) | stage move queued | expected stage/version → conflict record | as record | Pipeline tab |
| F011 | Probability / expected revenue | READ_ONLY | native | web (governed action) | cached with opportunity | — | as record | Pipeline tab |
| F012 | Sales stages | WEB_WORKSPACE | web | web (settings) | no | — | none | `/crm/settings/pipeline-stages` |
| F013 | Calls | FIELD_OPTIMIZED | native | log, start, complete, cancel | queued | lifecycle state + version → conflict | none | Activities tab |
| F014 | Meetings | FIELD_OPTIMIZED | native | create, start, complete, cancel | queued | lifecycle state + version → conflict | as record (server projection) | Activities tab |
| F015 | Tasks | FIELD_OPTIMIZED | native | create, complete | queued | expected status + version → conflict | none | Activities tab |
| F016 | Follow-ups & reminders | FIELD_OPTIMIZED | native | create, complete | queued | expected status + version → conflict | none | Activities tab |
| F017 | Notes & attachments | READ_ONLY | native (record detail) | web | cached with record | — | private notes per note visibility | Activities tab / `/crm/leads` |
| F018 | Email history | WEB_WORKSPACE | web | web | no | — | email content per sensitive permission (metadata-only otherwise) | `/crm/communications` |
| F019 | Activity timeline | READ_ONLY | native (record detail) | n/a (projection) | cached with record | — | per-item visibility | Activities tab / `/crm/leads` |
| F020 | Territories & sales teams | WEB_WORKSPACE | web | web (coverage, reassign) | no | effective-dated, overlap-checked | quota amounts need revenue/analytics authority | `/crm/coverage` |
| F021 | Lead import & export | WEB_WORKSPACE | web | web (background job) | no | job-level idempotency | export respects field scope | `/crm/data/import-export` |
| F022 | Lead conversion | WEB_WORKSPACE | web | web (transactional) | no | idempotent conversion | as record | `/crm/leads` |
| F023 | Opportunity → quotation | WEB_WORKSPACE | web | web (Sales handoff) | no | Sales idempotency key | commercial data per Sales permissions | `/crm/opportunities` |
| F024 | Pipeline dashboard | READ_ONLY | native pipeline summary; full dashboard on web | n/a | cached summary | — | aggregates only over visible records | Pipeline tab / `/crm/dashboard` |
| F025 | Sales forecast | WEB_WORKSPACE | web | web (submit, review) | no | versioned submissions, period lock | team figures only for managers | `/crm/forecast` |
| F026 | Won / lost reasons | WEB_WORKSPACE | web | web (settings) | no | — | none | `/crm/settings/lost-reasons` |
| F027 | Lead scoring | WEB_WORKSPACE | web | web (settings) | no | — | none | `/crm/settings/lead-scoring` |
| F028 | Custom fields & tags | WEB_WORKSPACE | web | web (settings) | no | — | field-level visibility | `/crm/settings/custom-fields-and-tags` |
| F029 | Bulk actions | WEB_WORKSPACE | web | web (background job) | no | per-item version check | as record | `/crm/leads` |
| F030 | CRM reports | WEB_WORKSPACE | web | web (saved, scheduled) | no | — | each scheduled copy built with the recipient's own access | `/crm/reports` |

No capability is APPROVAL_ONLY or NOT_APPLICABLE: forecast review (F025) is a
manager web workflow, and every F-ID has at least a governed web path.
