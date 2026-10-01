# CRM activities (CRM-CAP-004)

Path: `services/api/src/modules/crm/activities/`

Owns F013 Calls, F014 Meetings, F015 Tasks, F016 Follow-ups and reminders, F017 Notes and attachments, F018 Email history and F019 Activity timeline: permission-safe seller work and its history.

Main files: `call-operations.js`, `meeting-operations.js`, `public-meetings.js`, `task-operations.js`, `activity-commands.js`, `communications.js` (email, shared inbox, provider sync, meeting booking and calendar), `communications/`, `follow-ups/`, `notes/`, `attachments/`, `timeline/`, `shared/notify.js`.

Depends on: `data-management` (shared record infrastructure), `lead-management` and `master-data` (parent-record field security).

## Boundary

Everything in this directory is private to the CRM module. Other modules, orchestration, the web app and the worker reach it only through `services/api/src/modules/crm/index.js` (enforced for other modules by `scripts/validation/verify-architecture.mjs`). Note that `services/api/src/index.js` still re-exports several files from here directly; that broad surface is pinned by `services/api/tests/crm-public-api-exports.test.mjs` until a later pass narrows it.
