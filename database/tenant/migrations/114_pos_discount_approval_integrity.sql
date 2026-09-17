BEGIN;

-- POS Session 3, F279 security fix (docs/03-modules/point-of-sale/
-- POS_IMPLEMENTATION_TRACKER.md): tenant.pos_cart_discount_approvals used
-- to be written by cart.js's own recordDiscountApproval() with
-- approved_by trusted directly from a client-supplied request field --
-- NOT OK IN NOT NULL DEFAULT now(), it looked like real evidence
-- (requested_by <> approved_by, a timestamp) but nothing had verified the
-- named approver ever authenticated or decided anything.
--
-- A row is now created the moment a discount is REQUESTED (status
-- 'pending', approved_by/approved_at NULL) alongside a real row in
-- public.approval_requests (command_key 'pos.discount.approve'), and is
-- only moved to 'approved'/'rejected' -- with approved_by/approved_at
-- populated from the ACTUAL deciding session -- by
-- approvePosCartDiscountApproval()/rejectPosCartDiscountApproval(),
-- reachable only through services/api/src/core/approvals.js's
-- decideApproval(). completePosCart() now refuses to complete a sale that
-- carries an above-threshold discount without a matching 'approved' row
-- bound to the cart's current version (assertPosCartDiscountsApproved()).
--
-- The original `CHECK (requested_by <> approved_by)` is left in place
-- unchanged: Postgres CHECK constraints pass when the expression
-- evaluates to NULL, so it already tolerates approved_by being NULL for a
-- still-pending row and continues to block self-approval once it is set.

ALTER TABLE tenant.pos_cart_discount_approvals
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','approved','rejected')),
  ADD COLUMN IF NOT EXISTS approval_request_id uuid REFERENCES public.approval_requests(id);

ALTER TABLE tenant.pos_cart_discount_approvals
  ALTER COLUMN approved_by DROP NOT NULL,
  ALTER COLUMN approved_at DROP NOT NULL,
  ALTER COLUMN approved_at DROP DEFAULT;

-- One live approval_requests row per discount-approval row -- decideApproval()
-- already prevents deciding the same request twice (status must be
-- 'pending'), this just guarantees the pairing itself is 1:1.
CREATE UNIQUE INDEX IF NOT EXISTS pos_cart_discount_approvals_request_uidx
  ON tenant.pos_cart_discount_approvals(approval_request_id)
  WHERE approval_request_id IS NOT NULL;

-- assertPosCartDiscountsApproved() looks up 'approved' rows for a specific
-- (cart_id, cart_version), and completePosCart()/apply* look up 'pending'
-- rows the same way (idempotent re-request) -- both are hot, per-checkout
-- paths.
CREATE INDEX IF NOT EXISTS pos_cart_discount_approvals_status_idx
  ON tenant.pos_cart_discount_approvals(organization_id,cart_id,cart_version,status);

COMMIT;
