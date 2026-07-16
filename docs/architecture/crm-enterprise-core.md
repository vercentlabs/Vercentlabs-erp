# Enterprise CRM Core

## Purpose

This phase extends the existing Vercent ERP CRM from lead and opportunity execution into governed enterprise revenue operations. It keeps the CRM inside the tenant database, preserves organisation/company/branch isolation, and uses provider-neutral contracts for later communication and AI integrations.

## Capabilities delivered

### Revenue operations

- Hierarchical sales teams and membership foundations.
- Hierarchical territories with rule metadata and effective-dated assignments.
- Revenue, bookings, margin, quantity, new-logo, and activity quotas.
- Forecast periods, seller/manager submissions, commit/best-case/pipeline/closed values, confidence, adjustments, approval states, and snapshots.
- Revenue-operations reporting for quota attainment, pipeline coverage, win rate, and average sales cycle.

### Strategic account management

- Account plans linked to governed business parties.
- Account tier, lifecycle, annual and potential revenue, renewal date, health score, risks, objectives, success plan, and white-space opportunities.
- Stakeholder maps for economic buyers, decision makers, champions, blockers, procurement, legal, technical users, influence, sentiment, and relationship ownership.
- Account-health reporting.

### Guided selling and playbooks

- BANT, MEDDIC, MEDDPICC, SPIN, Challenger, and custom playbooks.
- Stage-aware required questions and evidence.
- Opportunity stage exit is blocked when required playbook responses are missing.
- Provider-neutral response source values allow later AI suggestions while retaining human review.

### Consent, privacy, and data quality

- Immutable consent evidence by channel, purpose, lawful basis, source, and timestamp.
- Data-subject/privacy request tracking for access, export, correction, deletion, restriction, objection, and consent withdrawal.
- Data-quality scores for completeness, validity, freshness, duplicate risk, and remediation issues.
- Privacy operations reporting and dedicated permissions.

## Security and governance

- Every new tenant table has forced PostgreSQL row-level security through the organisation-isolation policy.
- Every user-facing top-level resource is company scoped.
- Consent evidence cannot be edited or deleted; changes require a new event.
- Forecast submissions use governed transitions.
- Completed privacy requests cannot be reopened.
- Separate permissions exist for revenue operations, account strategy, playbooks, privacy, data quality, integrations, and AI administration.

## Enterprise CRM target architecture

The complete CRM target includes the following capability domains. They are intentionally delivered in independently verifiable phases rather than one unsafe patch.

1. **Enterprise core** — revenue operations, account planning, playbooks, consent, privacy, and data quality. This document covers this phase.
2. **Unified engagement** — Gmail and Microsoft 365 OAuth, two-way email/calendar sync, shared inbox, WhatsApp/SMS/telephony adapters, templates, signatures, scheduled sends, bounce/delivery/read events, sync cursors, retries, and conflict handling.
3. **Conversation intelligence** — recordings, transcripts, speaker segments, topics, objections, commitments, follow-up extraction, coaching scorecards, AI suggestions, human approval, model audit, and retention controls.
4. **Lead-to-cash** — quotation versions, item configuration, price lists, discounts, tax, payment terms, approvals, e-signature, acceptance, sales-order conversion, subscription/renewal handoff, and won revenue reconciled to ERP invoices and receipts.
5. **Customer service and success** — cases, queues, SLAs, escalation, knowledge references, customer timeline, onboarding, adoption, health, churn risk, renewal and expansion.
6. **Enterprise platform administration** — custom objects/fields/layouts/formulas/record types, field-level security, sharing rules, bulk ownership transfer, sandbox promotion, integration monitoring, audit export, mobile/offline sync, field visits, route planning, and business-card capture.
7. **AI and revenue intelligence** — predictive lead/opportunity scoring, next-best action, pipeline inspection, anomaly/risk detection, forecast prediction, account research, enrichment, email/call assistance, and agent actions with policy and approval boundaries.

## Dependency boundaries

- Live Gmail/Microsoft/WhatsApp/telephony features require provider credentials, OAuth applications, webhook endpoints, secret-manager integration, and background workers.
- Quotation and sales-order completion requires the Sales module's document, pricing, tax, approval, inventory, invoicing, and accounting contracts.
- Predictive AI requires approved providers, training/evaluation data, privacy controls, cost limits, explainability, and human review.
- Offline mobile requires a conflict-resilient client sync protocol and encrypted device storage.

These dependencies are not represented as fake completed integrations. The schema and permissions introduced here are production foundations for the next verified phases.
