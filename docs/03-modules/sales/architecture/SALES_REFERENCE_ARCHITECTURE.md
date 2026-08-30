# Sales Reference Architecture

Authentication → organization → entitlement → action permission → company/record scope → validation → deterministic commercial rules → lifecycle/transaction → audit/outbox → public cross-module orchestration → response.

Boundary: CRM supplies qualified context; Stock owns availability/reservation/pick-pack-ship; Accounting owns posted invoice/AR/payment/credit; Procurement owns supplier/drop-ship purchase execution.
