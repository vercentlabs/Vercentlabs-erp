-- Goods Receipt (GRN): the receiving document completed.
--
--  * the header records when the goods physically arrived, the transport
--    (vehicle, carrier, tracking reference) and who physically received them;
--    one receiving warehouse per receipt.
--  * each line keeps the product's tracking rules at receipt (lot, serial,
--    expiry) with the lot's manufacture and expiry dates.
--  * goods held for inspection may be linked to a Quality inspection.
--  * discrepancies can point at the receipt's own files as evidence.
--  * products can require an expiry date on every lot received.
--  * when the company keeps perpetual inventory, posting a receipt can book
--    the stock against Goods Received Not Invoiced (Dr Inventory, Cr GRNI);
--    the supplier bill then clears GRNI instead of booking the goods as an
--    expense again. Off unless switched on, and it needs the 'inventory' and
--    'grni' account mappings.

ALTER TABLE tenant.goods_receipts ADD COLUMN IF NOT EXISTS physical_received_at timestamptz;
ALTER TABLE tenant.goods_receipts ADD COLUMN IF NOT EXISTS vehicle_number text;
ALTER TABLE tenant.goods_receipts ADD COLUMN IF NOT EXISTS carrier_name text;
ALTER TABLE tenant.goods_receipts ADD COLUMN IF NOT EXISTS tracking_reference text;
ALTER TABLE tenant.goods_receipts ADD COLUMN IF NOT EXISTS received_by_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL;
ALTER TABLE tenant.goods_receipts ADD COLUMN IF NOT EXISTS accrual_journal_entry_id uuid REFERENCES tenant.accounting_journal_entries(id);
ALTER TABLE tenant.goods_receipts ADD COLUMN IF NOT EXISTS accrual_reversal_journal_entry_id uuid REFERENCES tenant.accounting_journal_entries(id);
ALTER TABLE tenant.goods_receipts ADD COLUMN IF NOT EXISTS accrual_amount numeric(20,6);
CREATE INDEX IF NOT EXISTS goods_receipts_received_by_idx ON tenant.goods_receipts (organization_id, received_by_user_id);

ALTER TABLE tenant.goods_receipt_lines ADD COLUMN IF NOT EXISTS tracking_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE tenant.goods_receipt_lines ADD COLUMN IF NOT EXISTS expiry_date date;
ALTER TABLE tenant.goods_receipt_lines ADD COLUMN IF NOT EXISTS manufactured_date date;
ALTER TABLE tenant.goods_receipt_lines ADD CONSTRAINT goods_receipt_lines_lot_dates_check CHECK (manufactured_date IS NULL OR expiry_date IS NULL OR manufactured_date <= expiry_date);

ALTER TABLE tenant.goods_receipt_dispositions ADD COLUMN IF NOT EXISTS quality_inspection_id uuid REFERENCES tenant.quality_inspections(id);
ALTER TABLE tenant.goods_receipt_discrepancies ADD COLUMN IF NOT EXISTS evidence_file_ids uuid[] NOT NULL DEFAULT '{}';

ALTER TABLE tenant.items ADD COLUMN IF NOT EXISTS requires_expiry_date boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN tenant.items.requires_expiry_date IS 'A lot-tracked product whose every lot needs an expiry date when received.';

ALTER TABLE tenant.procurement_settings ADD COLUMN IF NOT EXISTS post_receipt_accrual boolean NOT NULL DEFAULT false;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0047_goods_receipt.sql', 'goods-receipt');
