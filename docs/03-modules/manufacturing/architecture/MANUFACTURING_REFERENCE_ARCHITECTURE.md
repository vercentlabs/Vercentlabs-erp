# Manufacturing Reference Architecture

Manufacturing owns production definition, planning intent, work-order execution and production cost facts. Stock owns physical inventory movements/balances/valuation; Quality owns inspection/NCR/hold disposition; Procurement owns suppliers/POs/subcontract purchasing; Accounting owns the ledger; Assets owns asset/maintenance master state. Cross-module work uses public commands/events/orchestration.

Critical invariant order for a mutation: authentication → module entitlement → company/plant/work-centre scope → action/record permission → current aggregate/version → approved/effective BOM/routing/resource rules → material/quality/period checks → transaction/lock → authoritative public downstream command(s) → audit/outbox → response/reconciliation reference.

Released work orders snapshot the structure/routing/effectivity basis. Posted material/output/cost facts are immutable and corrected through reversal/compensation. AI has no authority over deterministic production, inventory, quality or financial controls.
