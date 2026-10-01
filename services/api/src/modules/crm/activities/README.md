# CRM activities (CRM-CAP-004)

Path: `services/api/src/modules/crm/activities/`

Owns F013 Calls, F014 Meetings, F015 Tasks, F016 Follow-ups and reminders, F017 Notes and attachments, F018 Email history and F019 Activity timeline: permission-safe seller work and its history.

Main files: `call-operations.js`, `meeting-operations.js`, `public-meetings.js`, `task-operations.js`, `activity-commands.js`, `communications/`, `meetings/`, `follow-ups/`, `notes/`, `attachments/`, `timeline/`, `shared/notify.js`.

F014 and F018 layout:

- `meetings/meeting-booking.js` — the one slot engine, host availability, public guest input, book / cancel / reschedule (booking locks the meeting link `FOR UPDATE` and re-checks availability before inserting).
- `meetings/meeting-calendar.js` — inbound calendar delta ingestion and scheduled sync steps, the Meeting -> `crm_calendar_events` sync-intent row, outbound push preparation/result/job.
- `communications/email-service.js` — email composition, consent, suppression and send decision, queuing, mailbox ingestion, engagement events, email history / thread / dashboard reads.
- `communications/shared-inbox-service.js` — inbox setup and the membership-gated thread claim / read / status operations.
- `communications/provider-integrations.js` — Gmail / Microsoft 365: normalisation, webhook signatures, OAuth state, credentials, the trusted-host HTTP wrapper, delta fetch and calendar push.
- `communications/provider-sync.js` — on-demand sync of one provider account.
- `communications/communication-projection.js` — audience and content projection for communications.
- Small shared pieces: `communications-error.js`, `email-address.js`, `content-hash.js`; dormant `communications-acceptance.js`.

`communications.js` is a compatibility boundary only: it re-exports the names that used to be implemented there (enforced by `checkCrmCompatibilityBarrels`). New code goes in the owning file.

Depends on: `data-management` (shared record infrastructure), `lead-management` and `master-data` (parent-record field security).

## Boundary

Everything in this directory is private to the CRM module. Other modules, orchestration, the web app and the worker reach it only through `services/api/src/modules/crm/index.js` (enforced for other modules by `scripts/validation/verify-architecture.mjs`). Inside the CRM module, import the owning capability file directly, never `../index.js` (enforced by `checkCrmSelfBoundaryImports` in `scripts/validation/architecture-rules.mjs`). Note that `services/api/src/index.js` still re-exports several files from here directly; that broad surface is pinned by `services/api/tests/crm-public-api-exports.test.mjs` until a later pass narrows it.
