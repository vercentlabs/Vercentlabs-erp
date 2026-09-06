BEGIN;

-- F035 gap: a one-off manual price override on a single order line already
-- requires sales.price.override AND a mandatory reason (calculateLine in
-- services/api/src/modules/sales/index.js). A standing, reusable negotiated
-- customer price (upsertSalesCustomerPrice, sales_pricing_rules with
-- party_type='customer') - the higher-blast-radius action, since it applies
-- to every future order for that customer/item - required neither. This
-- column lets the application enforce the same discipline for the bigger
-- action; nullable at the DB level since existing rows predate this and
-- other, non-customer-specific pricing_rules rows don't need one.
ALTER TABLE tenant.sales_pricing_rules
  ADD COLUMN IF NOT EXISTS reason text;

COMMIT;
