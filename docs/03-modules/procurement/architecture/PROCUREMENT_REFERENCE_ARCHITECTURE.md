# Procurement Reference Architecture

Authentication → organization → module entitlement/billing → action permission → company/branch/record/supplier scope → validation → deterministic procurement policy/state transition → database transaction → audit/outbox → public cross-module orchestration → response.

Boundaries: Procurement owns supplier purchasing governance, requisitions, sourcing and purchase commitments. Stock owns inventory quantities/movements/valuation; Quality owns inspection/hold/disposition; Accounting owns posted AP/tax/payment/ledger; Manufacturing owns production demand/BOM; Sales owns customer commitment/drop-ship demand; Projects owns project demand.

Critical writes are optimistic-concurrency and idempotency aware. Receipt, match, landed-cost, reorder and subcontract effects have reconciliation paths rather than hidden direct table coupling.
