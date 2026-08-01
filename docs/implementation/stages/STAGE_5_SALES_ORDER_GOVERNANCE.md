# Stage 5 — Sales Order, Fulfilment and Revenue Handoff Governance

## Purpose

Stage 5 governs the operational lifecycle after a quotation becomes a customer commitment. It extends the existing immutable sales-order engine rather than replacing it.

The stage makes readiness, delays, reservations, fulfilment handoffs, invoice handoffs, returns and commercial amendments visible and auditable across the API, web workspace and mobile secure-browser parity contract.

## Delivered scope

### Order readiness and health

- Commercial completeness checks for customer, payment terms, shipping address, customer PO policy and order lines.
- Warehouse readiness checks without pretending that an Inventory module already exists.
- Credit, active-hold, quantity-progress and lifecycle consistency checks.
- Approval, delivery, fulfilment, invoice-handoff and inactivity SLAs.
- Ready-to-submit, confirm, fulfil, invoice and close decisions.

### Fulfilment governance

- Governed line reservation updates for confirmed orders.
- Reservation quantities cannot exceed confirmed unfulfilled quantities.
- Order allocation status is recalculated after reservations.
- Existing idempotent fulfilment requests and completion flow remain authoritative.

### Revenue handoff governance

- Invoice eligibility is derived from lifecycle, holds, credit, remaining quantities and failed handoffs.
- Existing idempotent Sales-to-Accounting invoice requests remain authoritative.
- Dashboard queues expose ready-to-invoice and failed-handoff orders.

### Returns foundation

- Tenant-scoped, idempotent return requests.
- Return quantities cannot exceed fulfilled quantity still available to return.
- Return requests are auditable but do not post inventory or accounting entries; those postings remain responsibilities of their future governed modules.

### Operational workspace

- Sales-order governance dashboard and attention queues.
- Order-level readiness and timeline aggregation.
- Immutable-version comparison.
- Draft-only bulk owner and requested-delivery-date updates.
- Personal/shared saved views.
- Governance snapshots after order actions.

## Database

Tenant migration `021_sales_order_governance.sql` adds:

- `tenant.sales_order_governance_policies`
- `tenant.sales_order_saved_views`
- `tenant.sales_order_governance_snapshots`
- `tenant.sales_return_requests`

All four tables use forced row-level security and organisation isolation policies.

## Verification gates

- Stage 5 contract verification.
- Focused sales-order governance tests.
- Complete API tests.
- Web and mobile linting and typechecks.
- Control-plane and tenant migrations.
- Database, tenant and Sales verification.
- Live dashboard, saved-view, returns-foundation and RLS verification.
- Commit only after every gate passes.

## Explicit boundary

Stage 5 does not claim physical stock availability, warehouse movements, shipment labels, carrier integration, goods receipt, credit-note posting or inventory return posting. It creates governed handoffs and evidence for those downstream capabilities without fabricating them.
