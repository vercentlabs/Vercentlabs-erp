# CRM Overview + Lead Create — HCI implementation contract

Routes:
- `/crm`
- `/crm/leads?create=1`

This pass redesigns two high-value CRM surfaces while preserving the existing
service, permission, tenancy and route contracts.

## CRM overview

The overview is an operational decision surface, not a catalogue of every CRM
feature. It uses only the already-scoped `getCrmDashboard()` output:

- open and qualified leads,
- open opportunities,
- pipeline value and weighted pipeline,
- overdue and due-today activities,
- leads and conversions this month,
- pipeline-stage distribution,
- source performance,
- the open activity queue.

It then maps into specialist workspaces aligned with the planned CRM
information architecture: Relationships, Pipeline, Engagement, Growth,
Intelligence, Partners, and permission-gated Analytics.

No CAC, CLV, pipeline velocity, AI-generated summaries, territory optimisation
or other roadmap-only metric is fabricated on the overview.

## Lead Create

Lead Create becomes a dedicated full-page workflow instead of a generic CRUD
side panel. Create-time groups:

1. Lead identity
2. Contact details
3. Source & ownership
4. Commercial context / qualification
5. Location & follow-up
6. Communication preferences

Duplicate preview reuses `/api/crm/leads/duplicates`. Save reuses the existing
`POST /api/crm/leads` route. The existing service continues to own code
generation, supported owner assignment, initial scoring, score history and
`lead.created` automation.

## Capability boundary

The UI does not invent controls for capabilities that the feature evidence
still marks unavailable or provider-blocked. It does not add CRM attachment
upload, email-to-lead ingestion, live WhatsApp/SMS sending or call recording.

## Responsive contract

Both pages are explicitly designed for wide desktop, standard desktop, tablet,
small tablet, mobile and narrow mobile. No desktop-only side rail remains sticky
once it would reduce usable form width.


## Complete `/crm/leads` workspace

The normal Lead route is no longer a generic CRUD table.

It now includes:
- a dedicated Lead command header;
- direct links to Acquisition and Scoring/Nurture;
- scoped Open Leads, Qualified, Overdue Follow-ups and Due Today indicators
  using the existing `getCrmDashboard()` service;
- the existing server-backed text search;
- lifecycle filters for new/contacted/working/qualified/unqualified/converted/
  archived;
- a desktop queue focused on lead identity, owner/source, status, score,
  potential value and next follow-up;
- purpose-built mobile cards rather than a squeezed desktop table;
- import/export through the existing routes;
- open/edit/archive through the existing record contracts;
- a grouped Lead edit panel covering the canonical lead fields.

Advanced acquisition, SLA/scoring/nurture and other specialist functionality
stays in its existing specialist workspace instead of being duplicated into the
main queue.

# Enterprise Lead Suite completion pass

The Lead experience is treated as one connected route family:

- `/crm/leads`
- `/crm/leads?create=1`
- `/crm/leads/[id]`
- `/crm/lead-acquisition`
- `/crm/lead-intelligence`

The Lead queue now offers Table and lifecycle Kanban presentations, server-side
search and operational filtering, saved personal views, record-scope-safe bulk
updates, spreadsheet import/export, responsive mobile cards, and an accessible
non-drag status selector for Kanban moves. Conversion remains a governed record
action rather than an unsafe drag target.

Lead Acquisition now exposes CSV/XLSX/XLS preview-first batch import, public
capture-form creation/publishing, channel connections, the acquisition event
stream, review-required enrichment, and an application-side inbound-email
endpoint. Live Gmail, Microsoft 365, advertising, social or other external
providers still require their real credentials and provider-side webhook
forwarding; the ERP cannot manufacture those third-party credentials.

Lead Intelligence exposes deterministic explainable scoring, manual
recalculation, behaviour signals, first-response SLA controls, the seller
nurture queue, and assignment routing. The routing engine supports fixed,
round-robin, least-active-workload and territory-based workload assignment.
Product routing is expressed through product-interest policy criteria.

The Lead record itself now includes lifecycle controls, full timeline,
activities, manual communication logging, notes, conversion opportunities,
score history and duplicate comparison/merge.

Bulk operations apply company, branch and owner visibility scope. Team-wide
routing-policy administration requires both Lead manage and CRM record-view-all
permission.
