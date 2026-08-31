# Stock to Accounting valuation

Stock owns quantity and valuation layers; Accounting owns GL. Stock emits idempotent valuation journal intents with item/warehouse/source movement/cost-layer/dimension references. Accounting validates period/accounts and returns posting reference. Reversal/reconciliation is linked, never direct table mutation.
