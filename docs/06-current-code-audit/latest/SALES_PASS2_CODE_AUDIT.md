# Sales Pass 2 Current-Code Audit

The repository already contains meaningful Sales foundations: document editing, pricing preview, quotation/order governance, credit checks, fulfillment/invoice requests, returns, advances, drop-ship, commissions, dashboard/reporting and Stock orchestration. Evidence is not completion.

- **F031 Customer master** — `apps/web/src/modules/sales/components/document-editor.tsx` — verified as an inspected current-code artifact; full enterprise behavior remains gated by requirements/tests/UAT.
- **F032 Customer addresses and contacts** — `apps/web/src/modules/sales/components/document-editor.tsx` — verified as an inspected current-code artifact; full enterprise behavior remains gated by requirements/tests/UAT.
- **F033 Products and services** — `apps/web/src/modules/sales/components/document-editor.tsx` — verified as an inspected current-code artifact; full enterprise behavior remains gated by requirements/tests/UAT.
- **F034 Price lists** — `apps/web/src/app/api/sales/pricing/preview/route.ts` — verified as an inspected current-code artifact; full enterprise behavior remains gated by requirements/tests/UAT.
- **F035 Customer-specific prices** — `services/api/src/modules/sales/pass1-operations.js` — verified as an inspected current-code artifact; full enterprise behavior remains gated by requirements/tests/UAT.
- **F036 Quotations** — `services/api/src/modules/sales/quotation-governance.js` — verified as an inspected current-code artifact; full enterprise behavior remains gated by requirements/tests/UAT.
- **F037 Quotation versions and revisions** — `database/tenant/migrations/020_sales_quotation_governance.sql` — verified as an inspected current-code artifact; full enterprise behavior remains gated by requirements/tests/UAT.
- **F038 Quotation expiry** — `services/api/src/modules/sales/quotation-governance.js` — verified as an inspected current-code artifact; full enterprise behavior remains gated by requirements/tests/UAT.
- **F039 Discounts** — `apps/web/src/app/api/sales/pricing/preview/route.ts` — verified as an inspected current-code artifact; full enterprise behavior remains gated by requirements/tests/UAT.
- **F040 Taxes** — `services/api/src/modules/sales/index.js` — verified as an inspected current-code artifact; full enterprise behavior remains gated by requirements/tests/UAT.
- **F041 Approval workflow** — `services/api/src/modules/sales/quotation-governance.js` — verified as an inspected current-code artifact; full enterprise behavior remains gated by requirements/tests/UAT.
- **F042 Sales orders** — `services/api/src/modules/sales/order-governance.js` — verified as an inspected current-code artifact; full enterprise behavior remains gated by requirements/tests/UAT.
- **F043 Order confirmation** — `services/api/src/modules/sales/index.js` — verified as an inspected current-code artifact; full enterprise behavior remains gated by requirements/tests/UAT.
- **F044 Order amendments** — `database/tenant/migrations/021_sales_order_governance.sql` — verified as an inspected current-code artifact; full enterprise behavior remains gated by requirements/tests/UAT.
- **F045 Availability check** — `services/api/src/orchestration/sales-stock-reservation.js` — verified as an inspected current-code artifact; full enterprise behavior remains gated by requirements/tests/UAT.
- **F046 Stock reservation** — `services/api/src/orchestration/sales-stock-reservation.js` — verified as an inspected current-code artifact; full enterprise behavior remains gated by requirements/tests/UAT.
- **F047 Partial fulfilment** — `services/api/src/modules/sales/order-governance.js` — verified as an inspected current-code artifact; full enterprise behavior remains gated by requirements/tests/UAT.
- **F048 Backorders** — `services/api/src/modules/sales/order-governance.js` — verified as an inspected current-code artifact; full enterprise behavior remains gated by requirements/tests/UAT.
- **F049 Delivery and shipment** — `services/api/src/modules/sales/order-governance.js` — verified as an inspected current-code artifact; full enterprise behavior remains gated by requirements/tests/UAT.
- **F050 Sales invoices** — `services/api/src/modules/sales/index.js` — verified as an inspected current-code artifact; full enterprise behavior remains gated by requirements/tests/UAT.
- **F051 Partial invoicing** — `services/api/src/modules/sales/index.js` — verified as an inspected current-code artifact; full enterprise behavior remains gated by requirements/tests/UAT.
- **F052 Advance payments** — `services/api/src/modules/sales/pass1-operations.js` — verified as an inspected current-code artifact; full enterprise behavior remains gated by requirements/tests/UAT.
- **F053 Credit limits** — `services/api/src/modules/sales/index.js` — verified as an inspected current-code artifact; full enterprise behavior remains gated by requirements/tests/UAT.
- **F054 Customer returns** — `database/tenant/migrations/021_sales_order_governance.sql` — verified as an inspected current-code artifact; full enterprise behavior remains gated by requirements/tests/UAT.
- **F055 Credit notes and refunds** — `services/api/src/modules/sales/pass1-operations.js` — verified as an inspected current-code artifact; full enterprise behavior remains gated by requirements/tests/UAT.
- **F056 Drop shipping** — `services/api/src/modules/sales/pass1-operations.js` — verified as an inspected current-code artifact; full enterprise behavior remains gated by requirements/tests/UAT.
- **F057 Sales commissions** — `services/api/src/modules/sales/pass1-operations.js` — verified as an inspected current-code artifact; full enterprise behavior remains gated by requirements/tests/UAT.
- **F058 Payment terms** — `apps/web/src/modules/sales/components/document-editor.tsx` — verified as an inspected current-code artifact; full enterprise behavior remains gated by requirements/tests/UAT.
- **F059 Order status tracking** — `services/api/src/modules/sales/order-governance.js` — verified as an inspected current-code artifact; full enterprise behavior remains gated by requirements/tests/UAT.
- **F060 Sales analytics** — `apps/web/src/app/api/sales/dashboard/route.ts` — verified as an inspected current-code artifact; full enterprise behavior remains gated by requirements/tests/UAT.
- **F061 Margin and profitability** — `services/api/src/modules/sales/index.js` — verified as an inspected current-code artifact; full enterprise behavior remains gated by requirements/tests/UAT.
- **F062 Order-to-cash reporting** — `apps/web/src/app/api/sales/dashboard/route.ts` — verified as an inspected current-code artifact; full enterprise behavior remains gated by requirements/tests/UAT.
