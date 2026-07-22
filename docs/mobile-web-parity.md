# Mobile and web capability parity

This document records the customer-facing mobile scope against the current backend. Mobile parity means a task-appropriate mobile workflow, not a compressed desktop screen.

| Capability | Web/API source | Mobile source | Status | Decision |
|---|---|---|---|---|
| Mobile authentication, refresh, logout | `apps/web/src/app/api/mobile/v1/auth` | `apps/mobile/src/auth` | Complete | Secure device-bound tokens and offline data are cleared on logout. |
| Organization, company and branch context | mobile session API | `AppHeader`, `More` | Partial | Context is visible. Switching remains web-only because no mobile context mutation API exists. |
| CRM dashboard | mobile CRM dashboard API | mobile Home | Complete | Live KPIs with refresh and encrypted offline fallback. |
| Leads list and creation | mobile CRM resource API | CRM/Leads workspace | Complete | Search, status filters, refresh, offline read and queued create are supported. |
| Opportunities and pipeline | mobile opportunities/stage APIs | Pipeline workspace | Partial | List, search, filters and creation are supported. Stage-change UI awaits a record-detail API that supplies valid stages per record. |
| Activities | mobile activities/complete APIs | Work workspace | Complete | List, creation, completion, search, filters and offline mutation queue are supported. |
| Global search | mobile search API | Search screen | Complete | Searches leads, opportunities and activities. |
| Notifications | mobile notifications API | Notifications screen | Complete | List and mark-all-read are supported. |
| Permissions | mobile session and server authorization | module registry/navigation | Complete | Destinations are permission-aware; the server remains authoritative. |
| Offline and sync | mobile idempotency + encrypted SQLite | `src/data` | Partial | Cached reads and supported queued writes work. Conflict-heavy edits are intentionally online-only. |
| Contacts, accounts, notes, timeline and attachments | web CRM APIs only | — | Missing mobile API | Not represented as fake mobile features. Add scoped mobile endpoints before UI work. |
| CRM record view/edit/archive | web CRM APIs only | — | Missing mobile API | Requires mobile detail and patch endpoints plus permission-safe field metadata. |
| Web sidebar: Dashboard, CRM, Modules, Notifications | `apps/web/src/components/app-shell.tsx` | mobile tabs and `More` | Complete | Native destinations preserve the web information architecture with mobile-focused presentation. |
| Web sidebar: Master data, Billing, Audit logs | `apps/web/src/components/app-shell.tsx` | permission-aware `More` catalogue | API blocked | Visible only to authorized users and labelled Web until dedicated mobile-safe endpoints exist. |
| Web sidebar: Organisation, Companies, Branches, Departments, Teams, Cost centres, Users, Roles, Numbering series | `apps/web/src/components/app-shell.tsx` | permission-aware Administration section in `More` | API blocked | No sidebar entry is silently omitted. Sensitive mutations remain on web rather than reusing cookie-only routes. |
| Search, Security and Profile shortcuts | web top bar | native header, identity/context card, encrypted session and sign-out | Partial | Search is native. Profile identity and security protections are native; profile editing and security administration require mobile APIs. |
| Remaining 11 ERP modules | shared module catalog | module registry and roadmap | Architecture ready | Disabled until each module has released contracts, permissions, routes and workflows. |

## Scalable mobile boundary

`src/modules/registry.ts` is the single customer-navigation registry. A module becomes visible only when it is released, has a mobile route, and the signed-in user has its permission. Module-specific screens and components live under `src/features/<module>`; authentication, encrypted storage, API access, sync, theme and shared UI remain cross-module infrastructure.

## Next backend slice

The next parity milestone should add mobile-safe CRM detail and patch endpoints for leads, opportunities and activities, followed by contacts, accounts, notes/timeline and attachments. Each endpoint must preserve tenant isolation, server-side authorization and idempotency before the matching screen is enabled.
# Web-parity workspace

The mobile application now uses a hybrid architecture. Its primary **ERP** tab
loads the responsive authenticated web workspace from
`EXPO_PUBLIC_WEB_APP_URL`. This makes every permission-aware web route,
sidebar destination, form, report, setting, and future released module
available with the same design and behavior on mobile. The existing native
CRM and Work tabs remain available for fast, cached field workflows.

Only same-origin navigation is allowed inside the embedded workspace.
Telephone, email, and HTTPS links to other origins are handed to the operating
system; other schemes are rejected. Android back navigation follows web
history before leaving the screen, and loading, network, and server failures
have explicit branded states.

Development on a USB-connected Android phone requires both services to bind to
an address reachable by the device, or ADB reverse mappings for ports 3000 and
3001. Production builds must set both `EXPO_PUBLIC_WEB_APP_URL` and
`EXPO_PUBLIC_API_URL` to HTTPS origins.
