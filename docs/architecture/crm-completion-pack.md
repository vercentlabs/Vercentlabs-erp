# CRM completion pack

## Purpose

This pack closes the remaining CRM-owned capability gaps before Vercentlabs
starts the Sales module. It extends the existing lead, opportunity, activity,
campaign, sequence, forecasting, account-planning, privacy and data-quality
foundation. It does not copy capabilities that properly belong to another ERP
module.

## Added CRM-owned capabilities

### Unified engagement

- Reusable engagement templates.
- Public meeting-link configuration.
- Provider-neutral email, calendar, telephony and messaging sync accounts.
- Governed conversations linked to leads, contacts, accounts and opportunities.
- Reviewed conversation summaries, objections, commitments, risks, next actions
  and coaching insights.
- Expanded automation actions for record updates, assignment, sequence
  enrollment, queued communication, recommendations and domain events.

Provider adapters remain required for Gmail, Microsoft 365, Zoom, telephony,
WhatsApp, transcription and other external systems. Raw provider credentials
must remain outside tenant tables; only secret-manager references are stored.

### Revenue and relationship intelligence

- Pipeline inspection snapshots and health scores.
- Explicit deal-risk records.
- Governed next-best-action recommendations.
- Buying committees and member roles.
- Relationship edges and account signals.
- Pipeline, engagement, relationship, partner and AI-governance reports.

The schema can store rules-based or externally generated intelligence. An AI
prediction is not treated as a business fact until reviewed or acted upon.

### Partner and field selling

- Partner accounts and deal registration.
- Partner contribution and expected-value tracking.
- Planned and completed field visits with location and outcome details.

Route optimization and offline synchronization belong to the Mobile application,
not to the CRM domain service.

### Analytics and customization

- Governed custom report definitions.
- Dashboards and widgets.
- Custom object definitions, custom fields and custom records.
- Server-side required-field, type, option, pattern, numeric-range and uniqueness
  validation for custom records.

### Data enrichment and governed AI

- Provider-neutral enrichment jobs.
- Versioned AI predictions with model metadata and input snapshots.
- Human feedback linked to predictions or recommendations.
- AI-governance reporting.

External enrichment and model execution require configured provider adapters,
consent, retention controls and commercial agreements. The completion pack does
not silently scrape or transmit customer data.

## Module boundaries

The following capabilities are intentionally not implemented in CRM:

- The **Sales module** owns product configuration, quotations, CPQ, pricing,
  approval of commercial terms, sales orders, contracts, invoicing handoff and
  lead-to-cash orchestration.
- The **Service module** owns cases, queues, service-level agreements, knowledge,
  omnichannel support and customer-service operations.
- The **Mobile application** owns offline-first storage, background sync, route
  optimization and device-specific field-sales workflows.
- Marketing journeys, advertising attribution and website content operations
  should be implemented in a dedicated Marketing module when required.

## Completion standard

After migrations and verification pass, CRM can be feature-frozen for the
current ERP milestone and development can move to the Sales module. Provider
adapters, model selection and advanced offline parity remain deployment
integrations, not reasons to duplicate adjacent modules inside CRM.
