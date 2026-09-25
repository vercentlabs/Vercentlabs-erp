BEGIN;

-- F041: an approver who is away delegates Sales approvals to a colleague for
-- a date range (SAP/D365/NetSuite approval substitution). Requests assigned
-- to the delegator in that window are routed to the delegate, and the
-- routing is recorded on the document's event trail.
CREATE TABLE IF NOT EXISTS tenant.sales_approval_delegations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  delegator_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  delegate_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  starts_on date NOT NULL,
  ends_on date NOT NULL,
  reason text NOT NULL CHECK (length(btrim(reason)) >= 5),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  revoked_at timestamptz,
  CHECK (delegator_user_id <> delegate_user_id),
  CHECK (starts_on <= ends_on)
);
CREATE INDEX IF NOT EXISTS sales_approval_delegations_lookup_idx
  ON tenant.sales_approval_delegations (organization_id, delegator_user_id, status, starts_on, ends_on);

ALTER TABLE tenant.sales_approval_delegations ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.sales_approval_delegations FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'tenant' AND tablename = 'sales_approval_delegations' AND policyname = 'organization_isolation') THEN
    CREATE POLICY organization_isolation ON tenant.sales_approval_delegations
      USING (organization_id = tenant.current_organization_id())
      WITH CHECK (organization_id = tenant.current_organization_id());
  END IF;
END $$;

-- F049: shipment evidence the customer can track — carrier, tracking number,
-- dispatch and proof of delivery — on the fulfilment request Sales already owns
-- (Stock still owns the stock movement itself).
ALTER TABLE tenant.sales_fulfillment_requests
  ADD COLUMN IF NOT EXISTS carrier text,
  ADD COLUMN IF NOT EXISTS tracking_number text,
  ADD COLUMN IF NOT EXISTS shipped_at timestamptz,
  ADD COLUMN IF NOT EXISTS delivered_at timestamptz,
  ADD COLUMN IF NOT EXISTS received_by text,
  ADD COLUMN IF NOT EXISTS delivery_note text;

-- F048: a promised date on a backorder carries the reason it was given.
ALTER TABLE tenant.sales_order_schedules
  ADD COLUMN IF NOT EXISTS promise_note text;

COMMIT;
