# VercentLabs ERP Support module

Support manages customer and internal service requests, queues, ownership, priorities, service targets, escalations, communications, knowledge and customer history.

## Ownership boundaries

- CRM remains the source of truth for accounts, contacts and commercial relationship context. Support retains governed links.
- Sales, Accounting, Projects, Assets and Quality remain the source of truth for their business records. Support links service requests without duplicating those systems.
- External email, telephony, messaging and social integrations remain provider-specific adapters. Support stores normalized communication history and external message identifiers.

## Controls

- Ticket lifecycle transitions are explicit and audited.
- Queue and assignee history is append-only.
- SLA deadlines are calculated from active policies.
- First outbound communication records first response.
- Resolution requires a resolution code.
- Escalations retain ownership and acknowledgement evidence.
- Every tenant Support table uses forced PostgreSQL row-level security.
