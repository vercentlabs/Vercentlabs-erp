-- Goods Receipts: the one canonical GRN, shared by Procurement (receiving against the order) and Inventory (the stock it posts).
--
-- A lot-tracked line can now be received in several lots: each lot is its own receipt line against the same order line, and the order line's
-- entitlement is checked across all of them. A receipt's stock takes effect on its receipt date, and a receipt dated in a closed accounting
-- period is not posted. Taking goods in on inspection hold or damaged (restricted stock) becomes its own permission, granted to whoever records
-- receipts today.

-- The lots of one order line on one receipt are found together.
CREATE INDEX IF NOT EXISTS goods_receipt_lines_receipt_order_line_idx ON tenant.goods_receipt_lines (organization_id, goods_receipt_id, purchase_order_line_id);

INSERT INTO public.permissions (key, name, category, description) VALUES
  ('procurement.receipts.accept_restricted', 'Accept restricted stock at receipt', 'Procurement',
   'Take goods into custody on inspection hold or damaged (restricted stock), rather than accepting or refusing them.')
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT DISTINCT existing.role_id, 'procurement.receipts.accept_restricted' FROM public.role_permissions existing
 WHERE existing.permission_key = 'procurement.receipts.manage'
ON CONFLICT DO NOTHING;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0068_goods_receipts.sql', 'goods-receipts');
