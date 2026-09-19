BEGIN;

-- F289 gap closure: receipt printing had no durable print-attempt
-- evidence at all. getPosSaleReceipt's own prior comment disclosed this
-- directly ("'Original' vs 'reprint' is derived from whether this is the
-- first read after completion or not tracked at all here -- a real
-- print-audit-log would need its own table"), and the frontend's
-- Original/Reprint badge was driven entirely by a client-supplied
-- `?original=1` URL query parameter -- trivially forgeable by any viewer,
-- not evidence of anything. This table is that real audit log.
--
-- What this CAN and CANNOT prove, deliberately: a browser cannot observe
-- whether a physical printer actually produced paper, so this table
-- records only that a print was REQUESTED (window.print() invoked) by a
-- specific user at a specific time -- never "printer confirmed" or
-- "print succeeded," which no code in this stack can honestly claim.
-- print_type is derived server-side from whether any prior row already
-- exists for this sale, never from client input.
CREATE TABLE IF NOT EXISTS tenant.pos_receipt_print_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  company_id uuid NOT NULL,
  sale_id uuid NOT NULL REFERENCES tenant.pos_sales(id),
  print_type text NOT NULL CHECK (print_type IN ('original','reprint')),
  outcome text NOT NULL DEFAULT 'requested' CHECK (outcome IN ('requested')),
  requested_by uuid NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pos_receipt_print_events_sale_idx
  ON tenant.pos_receipt_print_events(organization_id,company_id,sale_id,requested_at);

ALTER TABLE tenant.pos_receipt_print_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.pos_receipt_print_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pos_receipt_print_events_organization_isolation ON tenant.pos_receipt_print_events;
CREATE POLICY pos_receipt_print_events_organization_isolation ON tenant.pos_receipt_print_events
  USING (organization_id=tenant.current_organization_id())
  WITH CHECK (organization_id=tenant.current_organization_id());

-- Immutable, like every other evidence/audit table in this module
-- (pos_promotion_applications, pos_coupon_redemptions, audit_events): a
-- print event is a historical fact, never edited or deleted.
CREATE OR REPLACE FUNCTION tenant.pos_receipt_print_events_immutable()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'pos_receipt_print_events rows are immutable evidence and cannot be updated or deleted';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS pos_receipt_print_events_no_update ON tenant.pos_receipt_print_events;
CREATE TRIGGER pos_receipt_print_events_no_update
  BEFORE UPDATE OR DELETE ON tenant.pos_receipt_print_events
  FOR EACH ROW EXECUTE FUNCTION tenant.pos_receipt_print_events_immutable();

COMMIT;
