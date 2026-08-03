# CRM-04 — Communications, Inbox and Calendar

CRM-04 completes the governed communications layer for the current CRM release.
It operationalises shared inboxes, Gmail and Microsoft 365 delta synchronisation,
calendar ingestion, self-service meeting booking, email engagement evidence,
suppressions, signatures, templates and outbound delivery controls.

## Capability scope

- CRM-001 — Shared team inbox
- CRM-002 — Two-way Microsoft 365 and Google calendar sync
- CRM-004 — Self-service meeting scheduling
- CRM-005 — Email open, click, bounce and unsubscribe tracking
- CRM-036 — Actual email provider sync
- CRM-038 — Omnichannel conversation inbox
- CRM-040 — Email/SMS/WhatsApp template library
- CRM-045 — Meeting scheduling and calendar sync
- CRM-081 — Email send windows, throttling and deliverability controls

## Governance rules

1. Provider secrets remain outside tenant tables. `credential_reference` must
   point to an environment-backed secret containing an access token.
2. OAuth state and PKCE verifier hashes expire and are single-use.
3. Provider deltas are idempotent by provider message/event identifiers.
4. Synchronisation uses a lease and records jobs, cursors, failures and retry
   times.
5. Shared inbox claims fail closed when another agent owns the active lease.
6. Hard bounces, complaints and unsubscribe events create suppressions.
7. Outbound delivery checks suppressions, time windows and hourly limits before
   creating an outbox event.
8. Meeting booking checks calendar conflicts, buffers and minimum notice before
   creating the booking and calendar event.
9. Email-event and acceptance evidence rows are immutable and tenant-isolated.

## External acceptance

The local/staging gate validates provider adapters using representative Gmail
and Microsoft payloads plus a live PostgreSQL workflow. Production promotion of
provider-dependent capabilities still requires real OAuth applications,
credentials, public HTTPS webhooks and provider acceptance runs. The evidence
register states this dependency rather than hiding it.

## Verification

```sh
pnpm verify:crm-04
pnpm test:crm-04-live
pnpm verify:crm-04-complete
```
