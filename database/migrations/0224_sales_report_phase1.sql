-- Sales report, Phase 1 (half-built features finished).
-- H5: a quotation accepted online can become its sales order at once, when the company switches this on.
ALTER TABLE tenant.sales_settings ADD COLUMN IF NOT EXISTS order_on_online_acceptance boolean NOT NULL DEFAULT false;

-- H6: when the customer first opened the quotation's link. Its status does not change: Viewed is shown beside it, and the salesperson
-- is told once.
ALTER TABLE tenant.sales_quotations ADD COLUMN IF NOT EXISTS customer_viewed_at timestamptz;
