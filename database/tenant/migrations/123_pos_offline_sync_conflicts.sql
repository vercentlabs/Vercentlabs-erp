BEGIN;

-- F297/F298 (offline POS workspace + offline-to-online sync). A queued
-- offline sale that cannot be safely completed as-is at sync time (price
-- moved, stock ran out, item deleted, shift/period already closed, an
-- unsupported-while-offline payment method slipped through, or the
-- syncing session no longer holds the permission the offline action
-- needed) must land here for a human to resolve -- never be silently
-- dropped, never be silently completed at stale values. An accepted sync
-- needs no new table: services/api/src/modules/point-of-sale/index.js's
-- completePointOfSale already records the local transaction id as
-- tenant.pos_sales.idempotency_key, which IS the local-transaction-id ->
-- server-sale-id mapping this feature needs, and tenant.operation_idempotency
-- (keyed on the same local transaction id under the 'pos.offline.sync'
-- operation) is what makes a retried sync job of ANY outcome -- accepted
-- or conflicted -- a safe no-op rather than reprocessed.
CREATE TABLE IF NOT EXISTS tenant.pos_offline_sync_conflicts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  company_id uuid NOT NULL,
  local_transaction_id uuid NOT NULL,
  store_id uuid,
  terminal_id uuid,
  shift_id uuid,
  cashier_user_id uuid NOT NULL,
  conflict_type text NOT NULL CHECK (conflict_type IN (
    'price_changed','item_not_found','insufficient_stock','shift_closed',
    'customer_inactive','payment_unsupported','permission_denied',
    'underpayment','other'
  )),
  error_code text,
  detail text,
  captured_payload jsonb NOT NULL,
  server_context_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','resolved_retried','resolved_voided')),
  resolution_reason text,
  resolved_sale_id uuid REFERENCES tenant.pos_sales(id) ON DELETE SET NULL,
  resolved_by uuid,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,local_transaction_id)
);
CREATE INDEX IF NOT EXISTS pos_offline_sync_conflicts_status_idx
  ON tenant.pos_offline_sync_conflicts(organization_id,company_id,status);

ALTER TABLE tenant.pos_offline_sync_conflicts ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.pos_offline_sync_conflicts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pos_offline_sync_conflicts_organization_isolation ON tenant.pos_offline_sync_conflicts;
CREATE POLICY pos_offline_sync_conflicts_organization_isolation ON tenant.pos_offline_sync_conflicts
  USING (organization_id=tenant.current_organization_id())
  WITH CHECK (organization_id=tenant.current_organization_id());

COMMIT;
