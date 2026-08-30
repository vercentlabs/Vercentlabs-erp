# Procurement Module Blueprint — Pass 3

**Canonical scope:** F063–F096. **Specification:** `SPECIFICATION_READY`. **Product readiness:** NOT CERTIFIED.

Procurement owns supplier purchasing governance, requisitions, sourcing, purchasing commitments and procurement-side receipt/match evidence. Stock owns physical inventory; Quality owns inspection/hold/disposition; Accounting owns posted AP/tax/payment/ledger truth; Manufacturing/Stock/Sales/Projects supply demand only through public contracts.

## Capability architecture

- `PROC-CAP-001` — Supplier identity, onboarding and segmentation — F063;F064;F065;F066
- `PROC-CAP-002` — Requisition and spend approval — F067;F068
- `PROC-CAP-003` — Competitive sourcing and award — F069;F070;F071;F072;F073
- `PROC-CAP-004` — Purchase order, agreement and supplier pricing governance — F074;F075;F076;F077;F078;F079
- `PROC-CAP-005` — Receiving, rejection and supplier returns — F080;F081;F082;F083
- `PROC-CAP-006` — Supplier invoice, matching and landed-cost control — F084;F085;F086;F087;F088
- `PROC-CAP-007` — Supplier performance and procurement intelligence — F089;F090;F091;F092;F093;F096
- `PROC-CAP-008` — Replenishment and subcontract purchasing orchestration — F094;F095

## Critical journeys
1. Supplier onboarding → spend authorization.
2. Requisition → approval → RFQ/bids → award → PO.
3. PO → partial/quality-aware receipt → Stock → supplier return.
4. PO/GRN → supplier invoice → 2/3-way match → Accounting.
5. Stock reorder → governed purchasing.
6. Manufacturing subcontract demand → purchase/receipt.
7. Receipt rejection → Quality hold/disposition → return/release.
