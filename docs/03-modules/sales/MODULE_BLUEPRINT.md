# Sales Module Blueprint — Pass 2

**Canonical scope:** F031–F062. **Specification:** `SPECIFICATION_READY`. **Product readiness:** NOT CERTIFIED.

Sales owns customer-facing commercial commitments; Stock owns physical inventory execution; Accounting owns posted financial truth; CRM supplies qualified opportunity context. Cross-module effects use public contracts/orchestration.

## Capability architecture

- `SALES-CAP-001` — Customer, catalog and pricing foundation — F031;F032;F033;F034;F035
- `SALES-CAP-002` — Quotation and commercial governance — F036;F037;F038;F039;F040;F041
- `SALES-CAP-003` — Sales order governance — F042;F043;F044
- `SALES-CAP-004` — Availability and fulfilment coordination — F045;F046;F047;F048;F049
- `SALES-CAP-005` — Billing, advances, credit and returns — F050;F051;F052;F053;F054;F055;F058
- `SALES-CAP-006` — Alternative fulfilment and compensation — F056;F057
- `SALES-CAP-007` — Order visibility, analytics and profitability — F059;F060;F061;F062

## Critical journeys
1. CRM opportunity → accepted quotation.
2. Quotation → confirmed/amended order.
3. Order → availability/reservation → partial fulfilment/backorder → delivery.
4. Order/delivery → invoice/advance → Accounting → payment.
5. Return → Stock reverse flow → credit/refund.
