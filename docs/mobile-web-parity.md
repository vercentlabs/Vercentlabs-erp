# Mobile and web capability parity

This document records the customer-facing mobile scope against the current
backend. Mobile parity means a task-appropriate native workflow, not a compressed
desktop screen or an embedded WebView.

| Capability | Web/API source | Mobile source | Status | Decision |
| --- | --- | --- | --- | --- |
| Authentication, refresh and logout | `apps/web/src/app/api/mobile/v1/auth` | `src/core/auth` | Complete | Device-bound access and rotating refresh tokens use one canonical API client. |
| Organization, company and branch context | mobile session API | app header and More | Partial | Context is visible. Switching remains web-only until a mobile mutation contract exists. |
| CRM dashboard | mobile CRM dashboard API | Home tab | Complete | Live KPIs use encrypted offline fallback. |
| Leads | mobile CRM list, detail and mutation APIs | Leads tab and record detail | Complete | Search, filters, detail, creation and queued offline creation are supported. |
| Opportunities and pipeline | mobile CRM list, detail and stage APIs | Pipeline tab and record detail | Complete | Users can inspect opportunities and move them through valid pipeline stages. |
| Activities | mobile CRM list, detail and completion APIs | Activities tab and record detail | Complete | List, detail, creation, completion, search and queued writes are supported. |
| Global search | mobile search API | Search screen | Complete | Searches leads, opportunities and activities. |
| Notifications | mobile notifications API | Notifications screen | Complete | List and mark-all-read are supported. |
| Permissions | mobile session and server authorization | module registry and navigation | Complete | Navigation is permission-aware and the server remains authoritative. |
| Offline cache and mutation queue | mobile idempotency API | `src/core/database` and `src/modules/crm/data` | Partial | Supported reads and queued writes are encrypted and scoped to the signed-in workspace. Conflict-heavy editing remains online-only. |
| Contacts, accounts, notes, timeline and attachments | web CRM APIs | — | Missing mobile API | Add scoped mobile contracts before exposing native UI. |
| Record edit and archive | web CRM APIs | read-only native detail | Partial | Patch exists for the supported CRM resources; permission-safe field metadata and archive UX remain future work. |
| Administration, master data, billing and audit | authenticated web routes | permission-aware More catalogue | Web only | Sensitive administration stays on web until dedicated mobile-safe APIs exist. |
| Remaining 11 ERP modules | shared module catalog | module registry and roadmap | Architecture ready | Disabled until each module has released contracts, permissions, routes and workflows. |

## Scalable mobile boundary

`src/core/modules/registry.ts` is the canonical native module registry.
Module-owned code lives under `src/modules/<module>`. Authentication, encrypted
storage, API access, providers, security, theme and reusable UI remain
cross-module infrastructure under `src/core` and `src/shared`.

The mobile app creates one authenticated API client so concurrent 401 responses
share a single refresh rotation. Offline data is bound to the user and
organization, purged when that boundary changes, and synchronized only during
an authenticated session.

## Next backend slice

Add mobile-safe contacts, accounts, notes, timeline and attachment APIs, then
permission-safe editable field metadata and archive operations. Preserve tenant
isolation, server authorization, idempotency and explicit conflict behavior
before exposing each matching native workflow.
