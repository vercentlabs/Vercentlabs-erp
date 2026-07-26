# Vercentlabs ERP CRM Module

The CRM module is a tenant-isolated customer-lifecycle capability built on the platform and Business Data foundations. It follows the permanent modular-monolith boundaries: canonical SQL in `database`, domain services in `services/api`, framework-neutral contracts in `packages`, and authenticated presentation plus current route adapters in `apps/web`.

## Covered capabilities

- Lead capture from staff entry, CSV and public forms with origin checks, honeypot rejection and rate limits.
- Configurable sources, campaigns, tags, lead scoring, duplicate detection and fixed or round-robin assignment.
- Lead table, qualification statuses, priority/rating, company and branch scope, next follow-up and complete timeline.
- Replay-safe conversion into Business Partner, Contact and Opportunity records.
- Configurable pipelines, stage history, Kanban movement, probability, expected close, win/loss and weighted forecast.
- Tasks, calls, meetings, email/SMS/WhatsApp logging, reminders, outcomes and overdue processing.
- Campaign attribution, communication history, follow-up sequences, automation rules and governed outbox events.
- Saved views, forecast targets, reports, CSV import/export, audit events, RBAC and forced PostgreSQL RLS.
- Provider-neutral integration records that store only secret-manager references, never credentials.

## Deliberate module boundary

Quotations, sales orders, invoicing and payment posting belong to Sales and Finance. CRM conversion creates the customer/contact/opportunity truth that those modules consume. External Gmail, Outlook, WhatsApp, SMS or telephony delivery becomes active only after an administrator configures provider credentials outside source control.
