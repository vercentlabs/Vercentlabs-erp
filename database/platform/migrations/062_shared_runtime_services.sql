BEGIN;

-- Shared runtime services (notifications, approvals, audit).

-- ------------------------------------------------------------------ notifications
-- Enough context to re-check a stored notification against the viewer's
-- CURRENT access at read time. All optional: older/system rows may lack them.
ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS category text,
  ADD COLUMN IF NOT EXISTS module_key text,
  ADD COLUMN IF NOT EXISTS entity_type text,
  ADD COLUMN IF NOT EXISTS entity_id text;

-- Deterministic backfill only: the category is the historical `type` for the
-- registered CRM categories, and the target record comes from the href shape
-- CRM writes (/crm/<resource>/<uuid>). Free-form message text is never parsed.
UPDATE notifications SET category = type, module_key = 'crm'
 WHERE category IS NULL
   AND type IN ('crm_assignment', 'crm_dwell_breach', 'crm_follow_up_reminder', 'crm_follow_up_escalation', 'crm_nurture_queue_due', 'crm_automation');

UPDATE notifications SET
  entity_type = CASE (regexp_match(href, '^/crm/([a-z-]+)/'))[1]
                  WHEN 'leads' THEN 'crm_lead'
                  WHEN 'opportunities' THEN 'crm_opportunity'
                  WHEN 'accounts' THEN 'crm_account'
                  WHEN 'contacts' THEN 'crm_contact'
                  WHEN 'follow-ups' THEN 'crm_activity'
                  ELSE NULL END,
  entity_id = (regexp_match(href, '^/crm/[a-z-]+/([0-9a-fA-F-]{36})(?:[/?#].*)?$'))[1]
 WHERE entity_type IS NULL AND module_key = 'crm'
   AND href ~ '^/crm/(leads|opportunities|accounts|contacts|follow-ups)/[0-9a-fA-F-]{36}([/?#].*)?$';

CREATE INDEX IF NOT EXISTS notifications_org_user_created_idx ON notifications(organization_id, user_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS notifications_org_user_unread_idx ON notifications(organization_id, user_id) WHERE read_at IS NULL;

-- ------------------------------------------------------------------ approvals
-- One pending request per logical approval target. The key is chosen per
-- command (a document, a document VERSION, a specific POS discount), so
-- legitimate sequential/versioned approvals stay possible.
ALTER TABLE approval_requests ADD COLUMN IF NOT EXISTS dedupe_key text;

UPDATE approval_requests SET dedupe_key = CASE command_key
    WHEN 'accounting.customer_invoice.approve' THEN command_payload->>'documentId'
    WHEN 'accounting.vendor_bill.approve' THEN command_payload->>'documentId'
    WHEN 'accounting.vendor_payment.approve' THEN command_payload->>'documentId'
    WHEN 'accounting.journal.approve' THEN command_payload->>'journalEntryId'
    WHEN 'accounting.budget.approve' THEN command_payload->>'budgetId'
    WHEN 'sales.quotation.approve' THEN (command_payload->>'quotationId') || ':' || (command_payload->>'quotationVersionId')
    WHEN 'sales.order.approve' THEN (command_payload->>'orderId') || ':' || (command_payload->>'orderVersionId')
    WHEN 'sales.order.amendment.approve' THEN command_payload->>'orderVersionId'
    WHEN 'pos.discount.approve' THEN command_payload->>'discountApprovalId'
    WHEN 'pos.payment.override.approve' THEN command_payload->>'paymentId'
    ELSE NULL END
 WHERE dedupe_key IS NULL;
-- Anything not derivable (or, defensively, any pending duplicate) keeps a unique legacy key.
UPDATE approval_requests SET dedupe_key = 'legacy:' || id::text WHERE dedupe_key IS NULL;
WITH ranked AS (
  SELECT id, row_number() OVER (PARTITION BY organization_id, command_key, dedupe_key ORDER BY requested_at, id) AS rank
    FROM approval_requests WHERE status = 'pending'
)
UPDATE approval_requests request SET dedupe_key = 'legacy:' || request.id::text FROM ranked WHERE ranked.id = request.id AND ranked.rank > 1;

-- The default keeps an older app instance (which does not send a key) working during rollout.
ALTER TABLE approval_requests ALTER COLUMN dedupe_key SET DEFAULT ('legacy:' || gen_random_uuid()::text);
ALTER TABLE approval_requests ALTER COLUMN dedupe_key SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS approval_requests_one_pending_uidx
  ON approval_requests(organization_id, command_key, dedupe_key) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS approval_requests_org_requester_idx ON approval_requests(organization_id, requested_by, requested_at DESC);
CREATE INDEX IF NOT EXISTS approval_requests_org_entity_idx ON approval_requests(organization_id, entity_type, entity_id) WHERE status = 'pending';

-- ------------------------------------------------------------------ audit read model
CREATE INDEX IF NOT EXISTS audit_events_org_created_id_idx ON audit_events(organization_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS audit_events_org_actor_created_idx ON audit_events(organization_id, actor_user_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS audit_events_org_type_created_idx ON audit_events(organization_id, event_type, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS audit_events_org_entity_created_idx ON audit_events(organization_id, entity_type, entity_id, created_at DESC, id DESC);
-- Superseded by audit_events_org_type_created_idx (same leading columns).
DROP INDEX IF EXISTS audit_events_event_type_idx;

COMMIT;
