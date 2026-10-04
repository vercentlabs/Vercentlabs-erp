-- Lead-to-Opportunity Conversion.
--
-- 1. tenant.crm_lead_conversions: one immutable record per converted lead —
--    which account, contact and opportunity it became, the decisions taken
--    (existing or new account and contact), any qualification or duplicate
--    override with its reason, and the request's idempotency key. A second
--    conversion of the same lead is impossible (unique lead_id), and a retried
--    request finds its first result by its key.
-- 2. Guards on tenant.crm_leads: a converted lead keeps its status, its
--    conversion stamp and its references (a merge may re-point a reference
--    to the kept record, never clear it), and is never deleted.
-- 3. Conversion permissions, granted to the roles that convert today.

-- ============================================================ 1. conversion record

CREATE TABLE tenant.crm_lead_conversions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES tenant.crm_leads(id),
  party_id uuid REFERENCES tenant.business_parties(id),
  contact_id uuid REFERENCES tenant.contacts(id),
  opportunity_id uuid REFERENCES tenant.crm_opportunities(id),
  account_decision text CHECK (account_decision IN ('existing', 'new')),
  contact_decision text CHECK (contact_decision IN ('existing', 'new')),
  lead_status_before text,
  qualification_override boolean NOT NULL DEFAULT false,
  override_reason text,
  missing_criteria jsonb NOT NULL DEFAULT '[]'::jsonb,
  duplicate_override_reason text,
  duplicate_overrides jsonb NOT NULL DEFAULT '[]'::jsonb,
  contact_updates jsonb NOT NULL DEFAULT '{}'::jsonb,
  open_work text CHECK (open_work IN ('move', 'keep')),
  moved_work_count integer NOT NULL DEFAULT 0,
  lead_owner_user_id uuid REFERENCES public.users(id),
  lead_source_id uuid,
  lead_created_at timestamptz,
  idempotency_key text,
  converted_by uuid REFERENCES public.users(id),
  converted_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT crm_lead_conversions_lead_key UNIQUE (organization_id, lead_id)
);
CREATE UNIQUE INDEX crm_lead_conversions_idempotency_idx ON tenant.crm_lead_conversions (organization_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX crm_lead_conversions_converted_idx ON tenant.crm_lead_conversions (organization_id, converted_at DESC);
CREATE INDEX crm_lead_conversions_opportunity_idx ON tenant.crm_lead_conversions (organization_id, opportunity_id);

-- Leads converted before this record existed.
INSERT INTO tenant.crm_lead_conversions (organization_id, lead_id, party_id, contact_id, opportunity_id, lead_status_before, lead_owner_user_id, lead_source_id, lead_created_at, converted_by, converted_at)
SELECT lead.organization_id, lead.id, lead.converted_party_id, lead.converted_contact_id, lead.converted_opportunity_id, 'qualified',
       lead.owner_user_id, lead.source_id, lead.created_at, lead.converted_by, COALESCE(lead.converted_at, lead.updated_at)
  FROM tenant.crm_leads lead
 WHERE lead.status = 'converted'
ON CONFLICT (organization_id, lead_id) DO NOTHING;

-- The record is history: only a merge may re-point its account, contact or opportunity to the kept record.
CREATE FUNCTION tenant.crm_lead_conversions_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'A lead conversion record cannot be deleted.' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.lead_id IS DISTINCT FROM OLD.lead_id OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
     OR NEW.converted_by IS DISTINCT FROM OLD.converted_by OR NEW.converted_at IS DISTINCT FROM OLD.converted_at
     OR NEW.account_decision IS DISTINCT FROM OLD.account_decision OR NEW.contact_decision IS DISTINCT FROM OLD.contact_decision
     OR NEW.qualification_override IS DISTINCT FROM OLD.qualification_override OR NEW.override_reason IS DISTINCT FROM OLD.override_reason
     OR NEW.duplicate_override_reason IS DISTINCT FROM OLD.duplicate_override_reason OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
     OR (OLD.party_id IS NOT NULL AND NEW.party_id IS NULL) OR (OLD.contact_id IS NOT NULL AND NEW.contact_id IS NULL)
     OR (OLD.opportunity_id IS NOT NULL AND NEW.opportunity_id IS NULL) THEN
    RAISE EXCEPTION 'A lead conversion record cannot be changed.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER crm_lead_conversions_guard BEFORE UPDATE OR DELETE ON tenant.crm_lead_conversions
  FOR EACH ROW EXECUTE FUNCTION tenant.crm_lead_conversions_guard();

ALTER TABLE tenant.crm_lead_conversions ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.crm_lead_conversions FORCE ROW LEVEL SECURITY;
CREATE POLICY organization_isolation ON tenant.crm_lead_conversions USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id());
GRANT SELECT, INSERT, UPDATE ON TABLE tenant.crm_lead_conversions TO vercent_app;
GRANT SELECT ON TABLE tenant.crm_lead_conversions TO vercent_worker;

-- ============================================================ 2. converted lead guards

CREATE FUNCTION tenant.crm_leads_conversion_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'converted' THEN
      RAISE EXCEPTION 'A converted lead cannot be deleted.' USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;
  -- Becoming converted needs the full set of references.
  IF NEW.status = 'converted' AND OLD.status IS DISTINCT FROM 'converted'
     AND (NEW.converted_at IS NULL OR NEW.converted_party_id IS NULL OR NEW.converted_contact_id IS NULL OR NEW.converted_opportunity_id IS NULL) THEN
    RAISE EXCEPTION 'A lead is converted only by the Convert action, with its account, contact and opportunity.' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status = 'converted' AND (
       NEW.status IS DISTINCT FROM 'converted' OR NEW.converted_at IS DISTINCT FROM OLD.converted_at OR NEW.converted_by IS DISTINCT FROM OLD.converted_by
       OR (OLD.converted_party_id IS NOT NULL AND NEW.converted_party_id IS NULL)
       OR (OLD.converted_contact_id IS NOT NULL AND NEW.converted_contact_id IS NULL)
       OR (OLD.converted_opportunity_id IS NOT NULL AND NEW.converted_opportunity_id IS DISTINCT FROM OLD.converted_opportunity_id)) THEN
    RAISE EXCEPTION 'A converted lead keeps its conversion.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER crm_leads_conversion_guard BEFORE UPDATE OR DELETE ON tenant.crm_leads
  FOR EACH ROW EXECUTE FUNCTION tenant.crm_leads_conversion_guard();

-- ============================================================ 3. permissions

INSERT INTO public.permissions (key, name, category, description) VALUES
  ('crm.leads.convert_use_existing', 'Use existing account or contact in conversion', 'CRM', 'Link a converted lead to an account or contact that already exists.'),
  ('crm.leads.convert_create_account', 'Create account during conversion', 'CRM', 'Create a new account from a lead while converting it.'),
  ('crm.leads.convert_create_contact', 'Create contact during conversion', 'CRM', 'Create a new contact from a lead while converting it.'),
  ('crm.leads.convert_change_owner', 'Change owner during conversion', 'CRM', 'Give the new opportunity, account or contact an owner other than the lead owner.'),
  ('crm.leads.convert_override_duplicate', 'Override duplicate warning in conversion', 'CRM', 'Create a new account or contact although a strong match exists, with a reason.')
ON CONFLICT (key) DO NOTHING;

-- Whoever converts leads today keeps doing so, with existing or new records.
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT DISTINCT existing.role_id, permission.key
  FROM public.role_permissions existing
  JOIN public.permissions permission ON permission.key = ANY (ARRAY['crm.leads.convert_use_existing', 'crm.leads.convert_create_account', 'crm.leads.convert_create_contact'])
 WHERE existing.permission_key = 'crm.leads.convert'
ON CONFLICT DO NOTHING;

-- Whoever may override qualification may also reassign and override duplicates while converting.
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT DISTINCT existing.role_id, permission.key
  FROM public.role_permissions existing
  JOIN public.permissions permission ON permission.key = ANY (ARRAY['crm.leads.convert_change_owner', 'crm.leads.convert_override_duplicate'])
 WHERE existing.permission_key = 'crm.leads.override_qualification'
ON CONFLICT DO NOTHING;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0018_crm_lead_conversion.sql', 'crm-lead-conversion');
