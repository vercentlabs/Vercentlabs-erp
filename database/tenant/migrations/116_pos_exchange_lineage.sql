BEGIN;

-- F293 exchanges (consolidated POS pass): an exchange is a linked return
-- (the accepted returned quantity) plus a replacement sale, never a
-- destructive mutation of either. This adds the one column needed to
-- express that lineage: which return (if any) a completed sale is the
-- replacement for. completePosExchange() (services/api/src/modules/
-- point-of-sale/features/exchanges.js) sets this by calling the existing,
-- already-tested completePointOfSaleReturn() and completePosCart()
-- exactly once each inside one transaction, then stamping this link --
-- it does not duplicate either function's stock/cash/payment logic.
ALTER TABLE tenant.pos_sales
  ADD COLUMN IF NOT EXISTS exchange_return_id uuid REFERENCES tenant.pos_returns(id);

CREATE INDEX IF NOT EXISTS pos_sales_exchange_return_idx
  ON tenant.pos_sales(organization_id, exchange_return_id)
  WHERE exchange_return_id IS NOT NULL;

COMMIT;
