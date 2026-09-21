# Support / Customer Service implementation tracker

Status of the Support module (features F343–F380, numbered as in `docs/03-modules/support/features/`)
against real evidence. "Verified" means exercised by a test on real PostgreSQL (RLS on, explicit role
permission sets, no organization-owner bypass) — not "code exists". The feature spec files in this repo
are generic Pass-10 template boilerplate (identical structure repeated per feature, no concrete
field-level detail), so this implementation follows standard mature help-desk conventions instead
(ticket lifecycle, SLA/entitlement, knowledge base, customer portal), reusing the platform's existing
customer/contact master data (`tenant.business_parties`, `tenant.contacts` — the same tables CRM,
Sales and Accounting already use) rather than inventing a separate "customer" concept for Support.

**This is not a completion claim.** What follows is what was built and proven, and — equally important —
what is still open.

## How it was verified

| Layer | Evidence |
|---|---|
| Domain on real Postgres (RLS on, explicit permission sets, no owner bypass) | `tests/integration/support-{tickets,service}.test.mjs` — 18 subtests |
| Combined regression with the rest of the platform | `node --test tests/integration/hr-*.test.mjs tests/integration/support-*.test.mjs`: 98 pass, 0 fail |
| Static gates | route-security matrix (0 unexplained gaps — `supportMutation`/`supportRead` registered as audited wrappers alongside every other module's), billing-mutation gate (0 unaccounted), eslint on every touched file (0 errors), `tsc --noEmit` (0 errors) |
| Page smoke test | every new route (`/support`, `/support/tickets`, `/support/queues`, `/support/portal-tickets`, …) compiles and responds (redirects to auth, not a 500) against the running dev server |

**Not done this pass, and explicitly not claimed:** a real-browser (Playwright) end-to-end journey, the
kind every other recently-built module (HR, Manufacturing) has. Given the time available this session,
priority went to a thoroughly tested domain layer and a fully wired, statically-verified web layer over
an additional browser-automation layer on top of already-proven logic. This is a real, acknowledged gap,
not an oversight — see "Known limits" below.

## Defects found by running against a real database (and fixed)

1. **`business_parties.currency_code` has a per-organization FK to `tenant.currencies`.** The test kit's
   seed customer party didn't seed a currency row first, so every test failed on `INSERT` before any
   subtest even ran. Fixed by seeding `INR` into `tenant.currencies` for the test organization, matching
   the same pattern already used by the POS test suites.
2. **`getSupportSettings` (permission-gated) was called from inside `createTicket` and
   `transitionTicket`**, so a portal customer creating their own ticket, or a customer's reply
   auto-resuming a `pending_customer` ticket, failed with "you do not have permission" even though the
   portal path itself was correctly permission-exempt. Split into an ungated internal `loadSettings()`
   used by those two callers, and kept the exported `getSupportSettings` permission-gated for the admin
   settings screen.
3. **The same shape of bug in `transitionTicket` itself**: a customer's inbound reply auto-triggers a
   `resume_from_customer` transition as a side effect of their own message, but `transitionTicket`
   unconditionally required `support.ticket.assign`. Added an `{ internal: true }` bypass used only by
   that one automatic call site, not exposed through the API.
4. **`recordCannedResponseUsage` (originally named `useCannedResponse`) tripped React's
   "Hooks must be called from a component" lint rule** purely because of its `use`-prefixed name — it is
   an ordinary async domain function, not a hook. Renamed at the source (not just eslint-disabled) since
   the same footgun would resurface for any future caller.
5. Two test-authoring bugs caught and fixed during the first run of each new test file: a reopen test
   tried to resolve a ticket still in `new` status (skipped the `open` transition first); an
   entitlement-quota test used a persona that itself held `support.manage` (which is allowed to override
   a quota), so the "quota exceeded" assertion never actually exercised the block — a dedicated
   `support.ticket.create`-only persona (no `support.manage`) was added to the test roles.

## Feature status

Legend: **Built+verified** · **Partial** (works, with named gaps) · **Not built**

| ID | Feature | Status | Notes / open gaps |
|---|---|---|---|
| F343 | Tickets and cases | Built+verified | Full lifecycle: create, list/get (staff-scoped or portal-scoped), update, assign, transition, merge. |
| F344 | Ticket number | Built+verified | Sequential via the platform's shared document-numbering sequence, prefix `TKT`. |
| F345 | Customer | Built+verified | Linked to the platform's real `tenant.business_parties` (the same customer master CRM/Sales/Accounting use), not a Support-owned copy. |
| F346 | Contact | Built+verified | Linked to `tenant.contacts`, validated to belong to the ticket's customer. |
| F347 | Category | Built+verified | Hierarchical, with a default queue and default priority. |
| F348 | Priority | Built+verified | Five-level enum; a routing rule or category can set it automatically. |
| F349 | Status | Built+verified | Explicit state machine (`new → open → pending_customer/internal → resolved → closed`, plus `reopen`, `cancel`, `merged`); every transition is recorded in `support_ticket_status_history`. |
| F350 | Queues | Built+verified | Manual, round-robin, least-loaded and skills-based assignment strategies, each tested against real auto-assignment behaviour. |
| F351 | Agent assignment | Built+verified | Manual assign/reassign, with a full history (`support_ticket_assignments`). |
| F352 | Automatic routing | Built+verified | Ordered rules matching channel/category/keyword, with a fallback to the category's default queue. |
| F353 | Email-to-ticket | Partial | The domain fully supports channel-agnostic creation and idempotent threading (`external_message_id` on `support_communications`); there is no actual SMTP/IMAP ingestion worker in this pass — a real mail pipeline would call `createTicket`/`addCommunication` the same way a web or portal request does. |
| F354 | Web ticket creation | Built+verified | `channel: 'web'`, both staff-created and portal-created. |
| F355 | Manual ticket creation | Built+verified | An agent creates a ticket on a customer's behalf via any channel. |
| F356 | Customer replies | Built+verified | Inbound communications, from the portal or recorded by staff; a reply while `pending_customer` auto-resumes the ticket and the SLA clock. |
| F357 | Internal / private notes | Built+verified | `private_note` communications, hidden from anyone without `support.sensitive.view` (the author always sees their own) and never visible to the portal. |
| F358 | Attachments | Built+verified | Size-capped (25 MB), optionally private, linkable to a specific message or the ticket as a whole. **No actual file storage/virus-scan integration** — `storage_key`/`scan_status` are modelled but nothing yet uploads bytes or runs a scan. |
| F359 | SLA policies | Built+verified | First-response and resolution targets, by priority, business-hours-only or 24×7. |
| F360 | First-response SLA | Built+verified | Computed at ticket creation; a simplified Mon–Fri 09:00–18:00 UTC business calendar for business-hours-only policies (not per-org-timezone, not holiday-aware — documented simplification). |
| F361 | Resolution SLA | Built+verified | Same mechanism; pauses while waiting on the customer (configurable per policy) and extends by the paused duration on resume. |
| F362 | SLA breach handling | Built+verified | A sweep (`checkSlaBreaches`) raises exactly one open escalation per breached ticket per policy trigger type, idempotently (re-running never double-escalates). |
| F363 | Escalations | Built+verified | Manual and automatic, with acknowledge/resolve/cancel and an optional priority override. |
| F364 | Reassignment | Built+verified | Same mechanism as F351; every reassignment is in the history with a reason. |
| F365 | Ticket history | Built+verified | A unified view over status changes, assignments, escalations and the full event log. |
| F366 | Reopen ticket | Built+verified | Only from `resolved`, only within the configured reopen window, always with a reason; `reopened_count` tracked. |
| F367 | Merge duplicate tickets | Built+verified | The duplicate becomes read-only (`status='merged'`) and linked to the primary; a merge or further action on an already-merged ticket is refused. |
| F368 | Tags | Built+verified | A `tags` array on the ticket, filterable server-side; editable via `updateTicket`. |
| F369 | Knowledge base | Built+verified | Draft → review → published (by someone other than the author, unless they hold `support.manage`) → retired, with revision (new draft version) and helpful/not-helpful rating. |
| F370 | Canned responses | Built+verified | Shared or private-to-owner, with a usage counter. |
| F371 | Customer portal | Built+verified | A real self-service surface: invite a customer's user, then they create/view/reply to their own tickets, see (non-private) attachments and the conversation, rate CSAT, and browse published customer/public knowledge articles — every read and write scoped server-side to their linked customer party, proven with a real portal persona holding zero `support.*` permissions. |
| F372 | Customer order history | Partial | Reads real Sales orders (`tenant.sales_orders`) for the ticket's customer. Query degrades to an empty list (not an error) if the Sales module's tables aren't present in a given environment. |
| F373 | Product linkage | Built+verified | A ticket can reference a real product (`tenant.items`), read through on the ticket detail. |
| F374 | Asset linkage | Built+verified | A ticket can reference a real asset (`tenant.assets`); its warranty dates are read through and a simple under/out-of-warranty flag is computed. |
| F375 | Warranty and service entitlement | Built+verified | A dedicated entitlement registry (customer + optional product, tier, SLA override, date range, optional ticket quota) is picked up automatically at ticket creation and enforces its quota (overridable by `support.manage`). |
| F376 | CSAT / customer rating | Built+verified | Requested automatically on resolution, submitted once by the customer through the portal (1–5 plus a comment), reported in aggregate and by agent. |
| F377 | Agent performance | Built+verified | Volume, resolved count, average first-response/resolution time, breach count and average CSAT, per agent. |
| F378 | SLA reporting | Built+verified | Met/breached counts by priority for first-response and resolution, plus what's at risk right now. |
| F379 | Ticket dashboards | Built+verified | Open/unassigned/high-priority counts, breach counts, open escalations, the viewer's own open tickets, resolved-today. |
| F380 | Complete audit trail | Built+verified | Every ticket event (`support_events`) plus status/assignment/escalation history, queryable per ticket or by event type. |

## Known limits of this work

- **No real-browser (Playwright) end-to-end test was written this pass** — see "How it was verified"
  above. The domain is proven on real Postgres; the web layer is proven by `tsc`/`eslint`/route-security
  gates and a live compile/response smoke test of every route, but no automated journey clicks through
  the actual UI yet.
- **No email/webhook ingestion worker** (F353): the domain supports it fully; nothing currently calls it
  from an inbox.
- **No file storage or virus-scan integration** (F358): attachments are modelled and permission-gated,
  but `addAttachment` takes a `storageKey` the caller supplies — nothing here uploads or scans bytes.
- **The business-hours calendar is a fixed Mon–Fri 09:00–18:00 UTC window**, not per-organization
  timezone-aware and not holiday-aware (unlike HR's shift/holiday-calendar system, which Support does
  not reuse).
- **Portal user invitation asks for a raw user id** rather than searching the organization's members by
  name/email — a real admin UX gap, not a security one (the domain still validates the user and
  customer/contact relationship).
- **Skills-based queue routing** matches a queue member's `skill_tags` against a ticket's own `tags`
  array (set at creation or via `updateTicket`), not against the ticket's category — a reasonable but
  simple interpretation, not validated against a specific enterprise benchmark.
- **CSAT is one rating per ticket**, not a multi-question survey.
- Accessibility and visual-regression gates were not run beyond the static/typecheck gates described
  above. Registers fetch up to 500–2000 rows per view depending on the list, matching every other
  module's convention in this codebase.
