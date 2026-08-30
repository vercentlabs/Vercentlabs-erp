# Procurement Pass 3 Current-Code Audit

The repository already contains meaningful Procurement foundations: supplier resources/sites/qualifications/certifications/scorecards, requisitions/distributions, sourcing invitations/bids/evaluations/awards, agreements, governed POs/amendments, receipts/returns, match exceptions/invoice matches, supplier prices/lead times, landed costs, reorder/subcontract requests, governance workspaces, reports/dashboard and permission definitions. Evidence is not completion.

- **F063 Supplier master** — `services/api/src/modules/procurement/index.js` — verified inspected current-code artifact; full enterprise behavior remains gated by approved requirements/tests/UAT.
- **F064 Supplier contacts and addresses** — `database/tenant/migrations/012_procurement_module.sql` — verified inspected current-code artifact; full enterprise behavior remains gated by approved requirements/tests/UAT.
- **F065 Supplier onboarding** — `services/api/src/modules/procurement/governance.js` — verified inspected current-code artifact; full enterprise behavior remains gated by approved requirements/tests/UAT.
- **F066 Supplier categories** — `database/tenant/migrations/012_procurement_module.sql` — verified inspected current-code artifact; full enterprise behavior remains gated by approved requirements/tests/UAT.
- **F067 Purchase requisitions** — `services/api/src/modules/procurement/index.js` — verified inspected current-code artifact; full enterprise behavior remains gated by approved requirements/tests/UAT.
- **F068 Requisition approvals** — `services/api/src/modules/procurement/index.js` — verified inspected current-code artifact; full enterprise behavior remains gated by approved requirements/tests/UAT.
- **F069 RFQ creation** — `services/api/src/modules/procurement/index.js` — verified inspected current-code artifact; full enterprise behavior remains gated by approved requirements/tests/UAT.
- **F070 RFQ to multiple vendors** — `database/tenant/migrations/012_procurement_module.sql` — verified inspected current-code artifact; full enterprise behavior remains gated by approved requirements/tests/UAT.
- **F071 Supplier quotations** — `services/api/src/modules/procurement/index.js` — verified inspected current-code artifact; full enterprise behavior remains gated by approved requirements/tests/UAT.
- **F072 Bid comparison** — `services/api/src/modules/procurement/index.js` — verified inspected current-code artifact; full enterprise behavior remains gated by approved requirements/tests/UAT.
- **F073 Supplier selection** — `services/api/src/modules/procurement/index.js` — verified inspected current-code artifact; full enterprise behavior remains gated by approved requirements/tests/UAT.
- **F074 Purchase orders** — `services/api/src/modules/procurement/index.js` — verified inspected current-code artifact; full enterprise behavior remains gated by approved requirements/tests/UAT.
- **F075 PO approvals** — `services/api/src/modules/procurement/index.js` — verified inspected current-code artifact; full enterprise behavior remains gated by approved requirements/tests/UAT.
- **F076 PO amendments** — `services/api/src/modules/procurement/index.js` — verified inspected current-code artifact; full enterprise behavior remains gated by approved requirements/tests/UAT.
- **F077 Blanket purchase orders** — `database/tenant/migrations/013_procurement_enterprise_completion.sql` — verified inspected current-code artifact; full enterprise behavior remains gated by approved requirements/tests/UAT.
- **F078 Purchase agreements and contracts** — `database/tenant/migrations/013_procurement_enterprise_completion.sql` — verified inspected current-code artifact; full enterprise behavior remains gated by approved requirements/tests/UAT.
- **F079 Supplier price lists** — `services/api/src/modules/procurement/pass1-operations.js` — verified inspected current-code artifact; full enterprise behavior remains gated by approved requirements/tests/UAT.
- **F080 Goods receipt / GRN** — `services/api/src/modules/procurement/index.js` — verified inspected current-code artifact; full enterprise behavior remains gated by approved requirements/tests/UAT.
- **F081 Partial receipts** — `database/tenant/migrations/014_procurement_integrity_hardening.sql` — verified inspected current-code artifact; full enterprise behavior remains gated by approved requirements/tests/UAT.
- **F082 Rejected receipts** — `services/api/src/modules/procurement/index.js` — verified inspected current-code artifact; full enterprise behavior remains gated by approved requirements/tests/UAT.
- **F083 Purchase returns** — `services/api/src/modules/procurement/index.js` — verified inspected current-code artifact; full enterprise behavior remains gated by approved requirements/tests/UAT.
- **F084 Supplier invoices** — `apps/web/src/app/api/accounting/payables/procurement-matches/[id]/import/route.ts` — verified inspected current-code artifact; full enterprise behavior remains gated by approved requirements/tests/UAT.
- **F085 2-way matching** — `services/api/src/modules/procurement/index.js` — verified inspected current-code artifact; full enterprise behavior remains gated by approved requirements/tests/UAT.
- **F086 3-way matching: PO – GRN – Invoice** — `services/api/src/modules/procurement/index.js` — verified inspected current-code artifact; full enterprise behavior remains gated by approved requirements/tests/UAT.
- **F087 Landed costs** — `services/api/src/modules/procurement/pass1-operations.js` — verified inspected current-code artifact; full enterprise behavior remains gated by approved requirements/tests/UAT.
- **F088 Payment terms** — `services/api/src/modules/procurement/index.js` — verified inspected current-code artifact; full enterprise behavior remains gated by approved requirements/tests/UAT.
- **F089 Supplier performance** — `services/api/src/modules/procurement/index.js` — verified inspected current-code artifact; full enterprise behavior remains gated by approved requirements/tests/UAT.
- **F090 Supplier rating** — `services/api/src/modules/procurement/index.js` — verified inspected current-code artifact; full enterprise behavior remains gated by approved requirements/tests/UAT.
- **F091 Supplier lead times** — `services/api/src/modules/procurement/pass1-operations.js` — verified inspected current-code artifact; full enterprise behavior remains gated by approved requirements/tests/UAT.
- **F092 Spend analysis** — `apps/web/src/app/api/procurement/reports/[report]/route.ts` — verified inspected current-code artifact; full enterprise behavior remains gated by approved requirements/tests/UAT.
- **F093 Purchase history** — `apps/web/src/app/api/procurement/reports/[report]/route.ts` — verified inspected current-code artifact; full enterprise behavior remains gated by approved requirements/tests/UAT.
- **F094 Reorder-generated purchasing** — `services/api/src/modules/procurement/pass1-operations.js` — verified inspected current-code artifact; full enterprise behavior remains gated by approved requirements/tests/UAT.
- **F095 Subcontract purchasing** — `services/api/src/modules/procurement/pass1-operations.js` — verified inspected current-code artifact; full enterprise behavior remains gated by approved requirements/tests/UAT.
- **F096 Procurement dashboard** — `apps/web/src/app/api/procurement/dashboard/route.ts` — verified inspected current-code artifact; full enterprise behavior remains gated by approved requirements/tests/UAT.
