BEGIN;

-- POS Completion Program Prompt 3, Section 6D: safe, auditable backfill of
-- tenant.pos_return_payment_refunds for returns completed BEFORE migration
-- 130 introduced this exact per-payment refund-evidence table.
--
-- accounting-posting.js's own runtime fallback already produces a correct
-- journal for pre-130 returns via proportional reconstruction across
-- non-cash tender legs when the split is genuinely ambiguous (see its own
-- comment: "Falls back to the old reconstruction ONLY for a return
-- completed before this fix shipped"). This backfill deliberately does NOT
-- attempt that reconstruction here: writing an ESTIMATED split into a
-- table whose entire purpose is to hold the EXACT split captured at
-- refund time would make estimated data indistinguishable from genuine
-- exact evidence to any future auditor reading this table directly --
-- exactly the kind of fabricated financial value this program's own rules
-- forbid.
--
-- Scope, deliberately narrow: only returns refunded ENTIRELY in cash,
-- where the persisted cash movement total exactly equals the return's own
-- refund_total AND the underlying sale has zero non-cash tender legs.
-- For this exact case there is only one possible allocation -- it is not
-- an estimate, it is the unambiguous, fully-evidenced historical fact.
-- Any return funded by more than one tender (or any non-cash leg at all)
-- is deliberately left untouched; the existing runtime fallback continues
-- to serve those correctly and honestly via proportional allocation.
INSERT INTO tenant.pos_return_payment_refunds
  (organization_id, company_id, return_id, sale_id, payment_id, payment_method, provider_reference, refund_amount, created_by, created_at)
SELECT
  r.organization_id,
  r.company_id,
  r.id,
  r.sale_id,
  cash_payment.id,
  'cash',
  NULL,
  r.refund_total,
  coalesce(r.completed_by, r.approved_by, r.requested_by),
  coalesce(r.completed_at, r.approved_at, r.created_at)
FROM tenant.pos_returns r
JOIN LATERAL (
  SELECT p.id
  FROM tenant.pos_payments p
  WHERE p.organization_id = r.organization_id
    AND p.sale_id = r.sale_id
    AND p.payment_method = 'cash'
  ORDER BY p.captured_at ASC NULLS LAST
  LIMIT 1
) cash_payment ON true
WHERE r.refund_total > 0
  AND coalesce(r.completed_by, r.approved_by, r.requested_by) IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM tenant.pos_return_payment_refunds pr WHERE pr.return_id = r.id
  )
  AND NOT EXISTS (
    SELECT 1 FROM tenant.pos_payments p
    WHERE p.organization_id = r.organization_id
      AND p.sale_id = r.sale_id
      AND p.payment_method <> 'cash'
      AND p.status IN ('captured', 'partially_refunded', 'refunded')
  )
  AND r.refund_total = (
    SELECT coalesce(sum(-cm.amount), 0)
    FROM tenant.pos_cash_movements cm
    WHERE cm.reference_type = 'pos_return' AND cm.reference_id = r.id AND cm.movement_type = 'refund'
  );

COMMIT;
