# Product Evidence Register

Traces every specific product claim on the homepage back to `docs/landing-redesign/phase-1/product-intelligence.md` ("Publicly Usable Product Evidence" and "Cross-Module Workflows" sections), and confirms no claim contradicts that document's "Honest Limitations" section.

| Homepage claim (section) | Evidence source | Honest-limitations check |
|---|---|---|
| "A lead becomes an opportunity, a quotation, and an order without being re-typed" (Connected system) | Cross-Module Workflow 1 (Quote-to-Cash), `crm.js:2110`, `sales/index.js:645-1873` | Clear |
| "Priced with GST-aware tax rules, accepted publicly with a digital signature" (Connected system, Flagship workflow) | Evidence: "GST tax calculation automatically splits CGST/SGST vs. IGST"; "Customers can accept or reject a sales quotation via a public, single-use, hashed share link with a typed digital signature" | Clear |
| "Converted from the accepted quotation with a real-time credit check" (Flagship workflow) | Evidence: "Sales orders are checked against real-time aggregated customer credit exposure, under an advisory database lock, before confirmation" | Clear |
| "Warehouse & production see the same order and item records" (Connected system) | Cross-Module Workflow 1/3; shared item/order data model | Phrased as shared *records*, not "automatic stock deduction" — see limitation below |
| "Quality inspects incoming, in-process, and outgoing goods against the same item and batch records" (Connected system) | Cross-Module Workflow 5 (Physical-Goods Quality Gate) | Clear |
| "Invoice generated from the order through an auditable, idempotent handoff" (Connected system, Flagship workflow) | Cross-Module Workflow 1; Evidence: idempotent billing patterns used elsewhere (Workflow 7) | Clear — phrased as "generated from the order," not "automatically posted with no human step" |
| "A released manufacturing work order cannot proceed without proven component availability" (Role value — manufacturing) | Evidence: "A released manufacturing work order cannot proceed without proven component availability; every material issue/finished-goods receipt posts a real, auditable stock movement" | Clear |
| "Invoices generated from real orders, a governed close process, and an audit trail that holds up" (Role value — finance) | Evidence: period close is a governed, task-gated workflow; immutable audit trail | Clear |
| "Attendance-driven payroll with the same separation-of-duties controls" (Role value — HR) | Evidence: "Payroll runs require a different approver than the preparer" | Phrased as "attendance-driven," not "auto-posts to the general ledger" — avoids the payroll→Accounting limitation |
| "Discounts, purchase orders, and journal entries route to the right approver by policy" (Automation) | Cross-Module Workflow 10 (Platform-Wide Governed Approval Backbone) | Clear |
| "The person who creates a record can't approve it" (Automation) | Evidence: self-approval blocks on capitalization/disposal, payroll, leave approval | Clear |
| "A failed inspection places an automatic hold on the affected stock" (Automation) | Evidence: "Failed quality inspections automatically place an inventory hold" | Clear |
| "Twelve seeded system roles with hand-curated permission sets" / "Time-bound & scoped roles" (Security) | Evidence: "Role assignments can be time-bound and scoped to specific companies, branches, or departments" | Clear — no MFA claim made anywhere on the homepage (MFA is schema-present but not enforced per Honest Limitations) |
| "A database trigger rejects any attempt to alter or delete an audit log entry" (Security) | Evidence: "Every audit log entry is immutable at the database level — a Postgres trigger rejects UPDATE/DELETE even against application bugs" | Clear |
| "Structural, database-level isolation between companies and branches" / "Tenant isolation... enforced on every query" (Security) | Cross-Module Workflow 11 (Tenant Onboarding & Module Entitlement) | Clear |
| "945 operational + 94 shared platform" capability count (Breadth) | `CLAUDE.md`'s stated, settled product decision — 945 module-specific + 94 shared platform = 1,039 total | Per `CLAUDE.md`: treated as a settled fact, not re-audited this phase |
| "The Manufacturing module covers bills of materials, work orders, and production posting into a live stock ledger" (FAQ) | Cross-Module Workflow 3 (Make-to-Stock Production) | Clear |
| "Customers, items, suppliers, and open transactions are migrated and reconciled as part of implementation" (FAQ, Implementation section) | Standard implementation practice claim, not a specific code-evidence claim — phrased as a service commitment, not a product feature | N/A (service claim, not product-code claim) |

## Explicit avoidance of Honest Limitations

The homepage does **not** claim, anywhere:
- That a standard (non-Manufacturing, non-POS) sales order automatically deducts stock — the flagship workflow stops at "Invoice posted."
- That POS sales automatically create a Sales order or Accounting journal entry — POS is not mentioned in the flagship workflow at all this phase.
- A unified Accounting-fixed-asset-to-EAM-Assets pipeline — Assets is named only in the module index, with no cross-module automation claim attached.
- Automatic payroll-to-GL posting — HR & Payroll's homepage mention ("attendance-driven payroll with the same separation-of-duties controls") stops short of claiming ledger automation.
- MFA as an active, enforced control — Security section names role-based access, time-bound/scoped roles, approval workflows, immutable audit trail, and multi-company/tenant isolation only; MFA is not mentioned.
- Full ERP-on-mobile — mobile is not claimed anywhere on the homepage; it is out of this phase's scope (the homepage doesn't have a mobile-specific section).
- Customer names, logos, testimonials, user counts, revenue, market share, review scores, awards, or performance-improvement percentages — none exist in the codebase's real data, and none appear anywhere on the page.

## Screenshots as evidence

The 5 approved product screenshots (see `screenshot-capture-process.md`) are themselves a form of evidence stronger than any copy claim — a buyer can see the actual opportunity pipeline, quotation audit trail, sales-order governance state, lead list, and stock overview rendered by the real running product, populated with clearly-synthetic company names (Ironclad Industrial Systems, Meridian Fabrication Works, Solstice Tooling, Brightedge Engineering, Falcon Precision, Cascade Metalworks) that would not be mistaken for a real customer.
