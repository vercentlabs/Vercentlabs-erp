-- CRM deep bug audit (Oct 2026): the data and role changes behind the fixes.
--
--   1. Quotations need nobody else: Sales Head and Sales Manager write quotations (their approval is still separated from their own
--      quotations); a Sales Representative turns the company of their own deal into a customer.
--   2. Follow-ups of type Visit and WhatsApp; lead sources Walk-in and WhatsApp (added for organizations that already have their sources).
--   3. Qualification: a new organization asks only for the need. Organizations that never changed their requirements keep what they had
--      (need and who decides), so nothing changes under them.
--   4. The last "opportunity" words in the stage texts and the lost reason, where the organization kept the standard wording.
--      New leads start Cold (the rating then follows the answers).
--   5. Phone numbers with a country code other than +91 keep all their digits when compared (a +44 number never matches an Indian one).

-- ============================================================ 1. roles
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT role.id, grant_row.key FROM public.roles role
  JOIN (VALUES
    ('sales_head', 'sales.quotation.create'), ('sales_head', 'sales.quotation.revise'), ('sales_head', 'sales.quotation.change_payment_terms'),
    ('sales_manager', 'sales.quotation.create'), ('sales_manager', 'sales.quotation.revise'), ('sales_manager', 'sales.quotation.change_payment_terms'),
    ('sales_representative', 'crm.accounts.create_customer')
  ) AS grant_row(slug, key) ON grant_row.slug = role.slug
  JOIN public.permissions permission ON permission.key = grant_row.key
ON CONFLICT DO NOTHING;

-- ============================================================ 2. follow-up types and lead sources
ALTER TABLE tenant.crm_activities DROP CONSTRAINT IF EXISTS crm_activities_follow_up_type_check;
ALTER TABLE tenant.crm_activities ADD CONSTRAINT crm_activities_follow_up_type_check
  CHECK (follow_up_type IS NULL OR follow_up_type = ANY (ARRAY['call', 'email', 'meeting', 'demo', 'visit', 'whatsapp', 'other']));

ALTER TABLE tenant.crm_lead_sources DROP CONSTRAINT IF EXISTS crm_lead_sources_channel_check;
ALTER TABLE tenant.crm_lead_sources ADD CONSTRAINT crm_lead_sources_channel_check
  CHECK (channel = ANY (ARRAY['website', 'referral', 'partner', 'event', 'advertising', 'social', 'email', 'phone', 'walk_in', 'whatsapp', 'import', 'other']));
INSERT INTO tenant.crm_lead_sources (organization_id, code, name, channel, is_system, sort_order)
SELECT org.organization_id, source.code, source.name, source.channel, true, source.sort_order
  FROM (SELECT DISTINCT organization_id FROM tenant.crm_lead_sources) org
  CROSS JOIN (VALUES ('walk_in', 'Walk-in', 'walk_in', 115), ('whatsapp', 'WhatsApp', 'whatsapp', 116)) AS source(code, name, channel, sort_order)
 WHERE NOT EXISTS (SELECT 1 FROM tenant.crm_lead_sources existing WHERE existing.organization_id = org.organization_id AND existing.code = source.code)
ON CONFLICT DO NOTHING;

-- ============================================================ 3. qualification requirements
INSERT INTO tenant.crm_lead_qualification_settings (organization_id, need_required, budget_required, authority_required, timeline_required)
SELECT organization.id, true, false, true, false FROM public.organizations organization
 WHERE NOT EXISTS (SELECT 1 FROM tenant.crm_lead_qualification_settings settings WHERE settings.organization_id = organization.id)
ON CONFLICT DO NOTHING;
ALTER TABLE tenant.crm_lead_qualification_settings ALTER COLUMN authority_required SET DEFAULT false;
-- A new lead starts Cold; its rating then follows the qualification answers until someone sets it.
ALTER TABLE tenant.crm_leads ALTER COLUMN rating SET DEFAULT 'cold';

-- ============================================================ 4. wording kept as the standard
UPDATE tenant.crm_pipeline_stages SET description = 'The deal has been created and you are understanding the customer''s situation.'
 WHERE description = 'The opportunity has been created and you are understanding the customer''s situation.';
UPDATE tenant.crm_pipeline_stages SET guidance = replace(guidance, 'Then mark the opportunity won or lost', 'Then mark the deal won or lost')
 WHERE guidance LIKE '%Then mark the opportunity won or lost%';
UPDATE tenant.crm_lost_reasons SET name = 'Duplicate deal' WHERE code = 'duplicate_opportunity' AND name = 'Duplicate Opportunity';

-- ============================================================ 5. phone numbers abroad
CREATE OR REPLACE FUNCTION tenant.crm_normalize_phone(value text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
           WHEN btrim(COALESCE(value, '')) LIKE '+%' AND regexp_replace(value, '[^0-9]+', '', 'g') NOT LIKE '91%'
             THEN NULLIF(regexp_replace(value, '[^0-9]+', '', 'g'), '')
           ELSE NULLIF(right(regexp_replace(COALESCE(value, ''), '[^0-9]+', '', 'g'), 10), '')
         END
$$;
-- Recompute the stored comparisons of the numbers the rule changes (only those rows are touched).
UPDATE tenant.crm_leads SET mobile = mobile, phone = phone
 WHERE (btrim(COALESCE(mobile, '')) LIKE '+%' AND regexp_replace(mobile, '[^0-9]+', '', 'g') NOT LIKE '91%')
    OR (btrim(COALESCE(phone, '')) LIKE '+%' AND regexp_replace(phone, '[^0-9]+', '', 'g') NOT LIKE '91%');
UPDATE tenant.contacts SET mobile = mobile, phone = phone, alternate_phone = alternate_phone
 WHERE (btrim(COALESCE(mobile, '')) LIKE '+%' AND regexp_replace(mobile, '[^0-9]+', '', 'g') NOT LIKE '91%')
    OR (btrim(COALESCE(phone, '')) LIKE '+%' AND regexp_replace(phone, '[^0-9]+', '', 'g') NOT LIKE '91%')
    OR (btrim(COALESCE(alternate_phone, '')) LIKE '+%' AND regexp_replace(alternate_phone, '[^0-9]+', '', 'g') NOT LIKE '91%');

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0130_crm_audit_fixes.sql', 'crm-audit-fixes') ON CONFLICT DO NOTHING;
