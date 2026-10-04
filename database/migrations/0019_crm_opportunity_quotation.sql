-- Opportunity-to-Quotation Conversion.
--
-- The quotation is the Sales document (tenant.sales_quotations with its
-- immutable versions); this migration adds what the conversion and the
-- quotation's later life need:
-- 1. Quotation header facts: how and to whom it was sent, the recorded
--    customer decision (by whom, with a reference and notes), cancellation,
--    and the customer's own reference.
-- 2. Sales permissions: apply discounts, revise, record a rejection, cancel
--    (accepting on the customer's behalf already exists), granted to the
--    roles that do this work today.

-- ============================================================ 1. quotation header

ALTER TABLE tenant.sales_quotations
  ADD COLUMN IF NOT EXISTS customer_reference text,
  ADD COLUMN IF NOT EXISTS sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS sent_by uuid REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS sent_to text,
  ADD COLUMN IF NOT EXISTS sent_channel text,
  ADD COLUMN IF NOT EXISTS accepted_by uuid REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS rejected_by uuid REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS decision_reference text,
  ADD COLUMN IF NOT EXISTS decision_notes text,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_by uuid REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS cancel_reason text;

ALTER TABLE tenant.sales_quotations
  ADD CONSTRAINT sales_quotations_sent_channel_check CHECK (sent_channel IS NULL OR sent_channel IN ('email', 'manual', 'link'));

-- Quotations sent before this column existed: the send event is the record.
UPDATE tenant.sales_quotations quote
   SET sent_at = sent.occurred_at, sent_by = sent.actor_user_id, sent_channel = 'link'
  FROM (SELECT DISTINCT ON (entity_id) entity_id, organization_id, occurred_at, actor_user_id
          FROM tenant.sales_document_events
         WHERE entity_type = 'quotation' AND event_type = 'quotation.sent'
         ORDER BY entity_id, occurred_at DESC) sent
 WHERE sent.organization_id = quote.organization_id AND sent.entity_id = quote.id AND quote.sent_at IS NULL;

CREATE INDEX IF NOT EXISTS sales_quotations_opportunity_idx ON tenant.sales_quotations (organization_id, source_opportunity_id, created_at DESC) WHERE source_opportunity_id IS NOT NULL;

-- ============================================================ 2. permissions

INSERT INTO public.permissions (key, name, category, description) VALUES
  ('sales.discount.apply', 'Apply discounts', 'Sales', 'Give a line discount on a quotation or sales order.'),
  ('sales.quotation.revise', 'Revise quotations', 'Sales', 'Create a new revision of a quotation; the earlier revision is kept.'),
  ('sales.quotation.reject', 'Record quotation rejection', 'Sales', 'Record that the customer rejected a quotation.'),
  ('sales.quotation.cancel', 'Cancel quotations', 'Sales', 'Cancel a quotation that will not go ahead.')
ON CONFLICT (key) DO NOTHING;

-- Whoever writes quotations gives discounts and revises them.
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT DISTINCT existing.role_id, permission.key
  FROM public.role_permissions existing
  JOIN public.permissions permission ON permission.key = ANY (ARRAY['sales.discount.apply', 'sales.quotation.revise', 'sales.quotation.cancel'])
 WHERE existing.permission_key = 'sales.quotation.create'
ON CONFLICT DO NOTHING;

-- Whoever may override prices may also give discounts.
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT DISTINCT existing.role_id, 'sales.discount.apply'
  FROM public.role_permissions existing
 WHERE existing.permission_key = 'sales.price.override'
ON CONFLICT DO NOTHING;

-- Whoever sends quotations records the customer's answer.
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT DISTINCT existing.role_id, permission.key
  FROM public.role_permissions existing
  JOIN public.permissions permission ON permission.key = ANY (ARRAY['sales.quotation.reject', 'sales.quotation.accept_on_behalf'])
 WHERE existing.permission_key = 'sales.quotation.send'
ON CONFLICT DO NOTHING;

-- Approvers may cancel.
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT DISTINCT existing.role_id, 'sales.quotation.cancel'
  FROM public.role_permissions existing
 WHERE existing.permission_key = 'sales.quotation.approve'
ON CONFLICT DO NOTHING;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0019_crm_opportunity_quotation.sql', 'crm-opportunity-quotation');
