# Mobile and responsive-web parity

This document records the navigation and operation coverage between `apps/web`
at its mobile breakpoint and `apps/mobile`. Every protected web route must have
a permission-safe mobile destination, but a destination is not automatically a
native operation equivalent. Entries marked `native` provide the operation in
the app; entries marked `secure-browser-handoff` open the responsive web
workflow without embedding a WebView. Current native business-module coverage
focuses on CRM and selected Procurement workspaces. Sales and Accounting remain
primarily responsive-web workflows.

## Protected workspace

| Web capability | Native mobile capability | Status |
| --- | --- | --- |
| Responsive shell, drawer, search, notifications and account menu | `AppHeader`, native drawer and permission-filtered destinations | Complete |
| Organisation, company and branch context | Header context selector backed by `/api/mobile/v1/workspace` | Complete |
| Organisation dashboard | Hero, current context, linked metrics, quick actions, work and audit panels | Complete |
| CRM dashboard | Eight live metrics, stage health, lead sources and next actions | Complete |
| CRM records and configuration | Schema-driven list, status/search filters, create, edit and archive for every visible CRM definition | Complete |
| Leads and opportunities | Native list and full detail, related history, conversion, merge and governed stage movement | Complete |
| Activities | Native create, edit, completion and offline-safe CRM workflows | Complete |
| CRM pipeline and reports | Native Kanban stage movement and all permission-visible reports | Complete |
| CRM CSV exchange | Audited CSV sharing and governed 1,000-row import contract | Complete |
| Master data overview | Partner, item, warehouse and currency metrics plus all resource groups | Complete |
| Master data records | Search/status filtering, CSV sharing, create, edit and archive | Complete |
| Platform settings | Structure, access and controls groups with native resource editors | Complete |
| Users and invitations | Invite, resend, revoke, status, role and operating-scope management | Complete |
| Roles and permissions | Create and edit custom roles with grouped permission selection | Complete |
| Approvals | Pending/history list with optimistic-version approve and reject actions | Complete |
| Audit log | Searchable immutable audit history | Complete |
| Billing | Subscription summary, plans, native Razorpay checkout, verification, cancellation, profile, invoices and payments | Complete |
| Profile and security | Profile preferences, login history, password change and session revocation | Complete |
| Modules | Native released/roadmap capability registry | Complete |
| Global search | Cross-module company, branch, user, CRM and master-data results | Complete |
| Notifications | Native list, unread badge, mark-one and mark-all behavior | Complete |

The canonical route inventory lives in
`apps/mobile/src/core/modules/web-parity.ts`. Its automated contract test scans
every protected `apps/web/src/app/(app)/**/page.tsx` file and fails when a web
page family lacks an explicit native destination or secure browser handoff. The
test verifies routing coverage; it does not prove end-to-end operation parity.

## Authentication boundary

Login is fully native and uses device-bound access tokens with rotating refresh
tokens. Signup, invitation acceptance, email verification and password-reset
links use the system browser because they are email/token and CAPTCHA-bound
flows. This is an intentional secure handoff to the same responsive web design,
not an embedded web surface; no authentication feature is removed.

Browser mutations keep same-origin CSRF enforcement. Native mutations require
both a valid bearer token and the versioned `X-Vercentlabs-Client` mobile header.
Mobile responses are private, request-correlated and use the same tenant,
permission, audit, billing and idempotency boundaries as web.

## Design contract

The native theme mirrors the responsive web surface: 16 px page gutters, white
cards, `#E4E7EC` borders, `#F4F6FA` canvas, `#4F46E5` primary actions,
`#101828` navigation, compact uppercase eyebrows, 32 px mobile page headings,
44 px minimum controls and 12 px card radii. The mobile header preserves the
same hamburger, search, notifications, identity, operating-context and page
heading hierarchy.

Native layout adapts tables into scannable record cards, desktop forms into
full-height editors and the CRM board into horizontally scrolling 84vw columns.
Those are interaction-appropriate equivalents of the responsive web design,
not alternate feature sets.

## Scalable native boundary

`src/core/modules/registry.ts` remains the module registry. Module-owned code
lives under `src/modules/<module>`; authentication, encrypted storage, API
access, providers, security, theme and reusable UI stay under `src/core` and
`src/shared`.

The app owns one authenticated API client, so concurrent 401 responses share a
single refresh rotation. Offline data is encrypted, user-and-organisation
scoped, purged when that boundary changes and synchronized only inside an
authenticated session. Conflict-heavy administration remains online-only and
uses server versions instead of silently overwriting newer data.
