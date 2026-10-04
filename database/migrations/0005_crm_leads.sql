-- CRM Leads: every database object the Leads feature owns, in one file.
--
--   1. Lead sources
--   2. Leads
--   3. Lead tags
--   4. Lead history (audit trail)
--   5. Row-level security and grants
--   6. Links from other CRM tables to leads and lead sources
--   7. Permissions
-- Lead assignment (rules, history, settings) is defined in 0008_crm_lead_assignment.sql.
--
-- Run once, after the earlier files in this folder.
BEGIN;

-- ============================================================ 1. lead sources
-- Where a lead came from. Every organization gets the standard list the first
-- time sources are read (leads/sources.js); administrators add, rename and
-- deactivate them. A source is never deleted.

CREATE TABLE tenant.crm_lead_sources (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  description text,
  channel text DEFAULT 'other' NOT NULL,
  is_default boolean DEFAULT false NOT NULL,
  is_system boolean DEFAULT false NOT NULL,
  sort_order integer DEFAULT 100 NOT NULL,
  status text DEFAULT 'active' NOT NULL,
  archived_at timestamp with time zone,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT crm_lead_sources_organization_id_code_key UNIQUE (organization_id, code),
  CONSTRAINT crm_lead_sources_name_check CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
  CONSTRAINT crm_lead_sources_description_check CHECK (description IS NULL OR char_length(description) <= 500),
  CONSTRAINT crm_lead_sources_channel_check CHECK (channel = ANY (ARRAY['website', 'referral', 'partner', 'event', 'advertising', 'social', 'email', 'phone', 'walk_in', 'import', 'other'])),
  CONSTRAINT crm_lead_sources_sort_order_check CHECK (sort_order BETWEEN 0 AND 10000),
  CONSTRAINT crm_lead_sources_status_check CHECK (status = ANY (ARRAY['active', 'inactive']))
);
CREATE UNIQUE INDEX crm_lead_sources_organization_id_id_uidx ON tenant.crm_lead_sources (organization_id, id);
CREATE UNIQUE INDEX crm_lead_sources_normalized_name_uidx ON tenant.crm_lead_sources (organization_id, lower(btrim(name)));
CREATE UNIQUE INDEX crm_lead_sources_active_default_uidx ON tenant.crm_lead_sources (organization_id) WHERE is_default AND status = 'active' AND archived_at IS NULL;
CREATE INDEX crm_lead_sources_catalogue_idx ON tenant.crm_lead_sources (organization_id, status, sort_order, lower(name), id);
CREATE TRIGGER touch_updated_at BEFORE UPDATE ON tenant.crm_lead_sources FOR EACH ROW EXECUTE FUNCTION tenant.touch_updated_at();

-- ============================================================ 2. leads
-- Stage answers "where are we in the process?"; status answers "what is the
-- outcome of this record?". They are separate columns and change through
-- separate operations. A lead is never hard-deleted: it is archived.

CREATE TABLE tenant.crm_leads (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  code text NOT NULL,

  -- who
  first_name text,
  last_name text,
  full_name text GENERATED ALWAYS AS (NULLIF(btrim(COALESCE(first_name, '') || ' ' || COALESCE(last_name, '')), '')) STORED,
  company_name text,
  job_title text,
  email text,
  phone text,
  mobile text,
  website text,
  city text,
  state text,
  country_code character(2),

  -- where from, and what they want
  source_id uuid,
  source_detail text,
  campaign_id uuid,
  industry text,
  product_interest text,
  estimated_value numeric(18,2) DEFAULT 0 NOT NULL,
  currency_code character(3),
  purchase_timeframe text,
  priority text DEFAULT 'medium' NOT NULL,
  rating text DEFAULT 'warm' NOT NULL,
  description text,

  -- ownership
  owner_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  team_id uuid,
  assigned_at timestamp with time zone,

  -- lifecycle
  stage text DEFAULT 'new' NOT NULL,
  stage_changed_at timestamp with time zone DEFAULT now() NOT NULL,
  status text DEFAULT 'open' NOT NULL,

  -- qualification decision (the answers live in tenant.crm_lead_qualifications, 0009)
  qualified_at timestamp with time zone,
  qualified_by uuid REFERENCES public.users(id) ON DELETE SET NULL,

  -- disqualification
  disqualification_reason text,
  disqualification_notes text,
  disqualified_at timestamp with time zone,
  disqualified_by uuid REFERENCES public.users(id) ON DELETE SET NULL,

  -- conversion: set only by Convert Lead
  converted_at timestamp with time zone,
  converted_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  converted_party_id uuid,
  converted_contact_id uuid,
  converted_opportunity_id uuid,

  last_activity_at timestamp with time zone,

  -- consent and privacy (maintained by CRM privacy requests)
  consent_email boolean DEFAULT false NOT NULL,
  consent_sms boolean DEFAULT false NOT NULL,
  consent_whatsapp boolean DEFAULT false NOT NULL,
  do_not_contact boolean DEFAULT false NOT NULL,
  privacy_status text DEFAULT 'active' NOT NULL,
  anonymized_at timestamp with time zone,
  retention_until timestamp with time zone,
  legal_hold boolean DEFAULT false NOT NULL,
  custom_data jsonb DEFAULT '{}'::jsonb NOT NULL,

  archived_at timestamp with time zone,
  archived_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,

  -- normalized values used by duplicate detection
  normalized_email text GENERATED ALWAYS AS (tenant.crm_normalize_email(email)) STORED,
  normalized_mobile text GENERATED ALWAYS AS (tenant.crm_normalize_phone(mobile)) STORED,
  normalized_business_phone text GENERATED ALWAYS AS (tenant.crm_normalize_phone(phone)) STORED,
  normalized_name text GENERATED ALWAYS AS (tenant.crm_normalize_comparison_text(NULLIF(btrim(COALESCE(first_name, '') || ' ' || COALESCE(last_name, '')), ''))) STORED,
  normalized_company_name text GENERATED ALWAYS AS (tenant.crm_normalize_comparison_text(company_name)) STORED,

  CONSTRAINT crm_leads_organization_id_code_key UNIQUE (organization_id, code),
  -- A lead often arrives incomplete: only a name or a company is required.
  CONSTRAINT crm_leads_identity_present_check CHECK (
    NULLIF(btrim(COALESCE(first_name, '') || COALESCE(last_name, '')), '') IS NOT NULL OR NULLIF(btrim(COALESCE(company_name, '')), '') IS NOT NULL),
  CONSTRAINT crm_leads_estimated_value_check CHECK (estimated_value >= 0),
  CONSTRAINT crm_leads_priority_check CHECK (priority = ANY (ARRAY['low', 'medium', 'high'])),
  CONSTRAINT crm_leads_rating_check CHECK (rating = ANY (ARRAY['cold', 'warm', 'hot'])),
  CONSTRAINT crm_leads_purchase_timeframe_check CHECK (purchase_timeframe IS NULL OR purchase_timeframe = ANY (ARRAY['immediate', 'within_1_month', 'within_3_months', 'within_6_months', 'within_12_months', 'later', 'unknown'])),
  -- stage is one of the organization's lead stages: see 0010_crm_lead_stages.sql
  CONSTRAINT crm_leads_status_check CHECK (status = ANY (ARRAY['open', 'qualified', 'disqualified', 'converted'])),
  -- A disqualified lead always carries its reason; no other status does.
  CONSTRAINT crm_leads_disqualification_check CHECK ((status = 'disqualified') = (disqualification_reason IS NOT NULL)),
  CONSTRAINT crm_leads_disqualification_reason_check CHECK (disqualification_reason IS NULL OR disqualification_reason = ANY (ARRAY['not_interested', 'no_requirement', 'no_budget', 'not_decision_maker', 'bad_fit', 'duplicate', 'invalid_contact', 'unable_to_contact', 'competitor_selected', 'timing_not_suitable', 'other'])),
  -- Conversion references exist exactly when the lead is converted.
  CONSTRAINT crm_leads_conversion_check CHECK ((status = 'converted') = (converted_at IS NOT NULL)),
  CONSTRAINT crm_leads_privacy_status_check CHECK (privacy_status = ANY (ARRAY['active', 'restricted', 'anonymized', 'erased']))
);
-- (organization_id, id) is the target of every organization-scoped link to a lead.
CREATE UNIQUE INDEX crm_leads_organization_id_id_uidx ON tenant.crm_leads (organization_id, id);

ALTER TABLE tenant.crm_leads
  ADD CONSTRAINT crm_leads_source_id_organization_fkey FOREIGN KEY (organization_id, source_id) REFERENCES tenant.crm_lead_sources(organization_id, id) ON DELETE SET NULL (source_id),
  ADD CONSTRAINT crm_leads_campaign_id_organization_fkey FOREIGN KEY (organization_id, campaign_id) REFERENCES tenant.crm_campaigns(organization_id, id) ON DELETE SET NULL (campaign_id),
  ADD CONSTRAINT crm_leads_team_id_organization_fkey FOREIGN KEY (organization_id, team_id) REFERENCES tenant.crm_sales_teams(organization_id, id) ON DELETE SET NULL (team_id),
  ADD CONSTRAINT crm_leads_converted_party_id_organization_fkey FOREIGN KEY (organization_id, converted_party_id) REFERENCES tenant.business_parties(organization_id, id) ON DELETE SET NULL (converted_party_id),
  ADD CONSTRAINT crm_leads_converted_contact_id_organization_fkey FOREIGN KEY (organization_id, converted_contact_id) REFERENCES tenant.contacts(organization_id, id) ON DELETE SET NULL (converted_contact_id),
  ADD CONSTRAINT crm_leads_converted_opportunity_id_fkey FOREIGN KEY (converted_opportunity_id) REFERENCES tenant.crm_opportunities(id) ON DELETE SET NULL;

-- the working lists
CREATE INDEX crm_leads_list_idx ON tenant.crm_leads (organization_id, status, updated_at DESC, id DESC) WHERE archived_at IS NULL;
CREATE INDEX crm_leads_owner_idx ON tenant.crm_leads (organization_id, owner_user_id, status) WHERE archived_at IS NULL;
CREATE INDEX crm_leads_team_idx ON tenant.crm_leads (organization_id, team_id) WHERE team_id IS NOT NULL;
CREATE INDEX crm_leads_source_idx ON tenant.crm_leads (organization_id, source_id) WHERE source_id IS NOT NULL;
-- duplicate detection
CREATE INDEX crm_leads_duplicate_email_idx ON tenant.crm_leads (organization_id, normalized_email) WHERE normalized_email IS NOT NULL;
CREATE INDEX crm_leads_duplicate_mobile_idx ON tenant.crm_leads (organization_id, normalized_mobile) WHERE normalized_mobile IS NOT NULL;
CREATE INDEX crm_leads_duplicate_phone_idx ON tenant.crm_leads (organization_id, normalized_business_phone) WHERE normalized_business_phone IS NOT NULL;
CREATE INDEX crm_leads_duplicate_name_idx ON tenant.crm_leads (organization_id, normalized_name, normalized_company_name) WHERE normalized_name IS NOT NULL;
-- search
CREATE INDEX crm_leads_search_idx ON tenant.crm_leads USING gin (
  lower(COALESCE(code, '') || ' ' || COALESCE(full_name, '') || ' ' || COALESCE(company_name, '') || ' ' || COALESCE(email, '') || ' ' || COALESCE(mobile, '') || ' ' || COALESCE(phone, '')) public.gin_trgm_ops);
CREATE TRIGGER touch_updated_at BEFORE UPDATE ON tenant.crm_leads FOR EACH ROW EXECUTE FUNCTION tenant.touch_updated_at();

-- ============================================================ 3. lead tags

CREATE TABLE tenant.crm_lead_tags (
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL,
  tag_id uuid NOT NULL,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT crm_lead_tags_pkey PRIMARY KEY (organization_id, lead_id, tag_id),
  CONSTRAINT crm_lead_tags_lead_id_organization_fkey FOREIGN KEY (organization_id, lead_id) REFERENCES tenant.crm_leads(organization_id, id) ON DELETE CASCADE,
  CONSTRAINT crm_lead_tags_tag_id_organization_fkey FOREIGN KEY (organization_id, tag_id) REFERENCES tenant.crm_tags(organization_id, id) ON DELETE CASCADE
);
CREATE INDEX crm_lead_tags_tag_idx ON tenant.crm_lead_tags (organization_id, tag_id);

-- ============================================================ 4. lead history
-- The audit trail: one append-only row per important change. The application
-- roles can only read and add rows (see the grants below).

CREATE TABLE tenant.crm_lead_history (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL,
  event_type text NOT NULL,
  summary text NOT NULL,
  changes jsonb DEFAULT '{}'::jsonb NOT NULL,
  actor_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT crm_lead_history_event_type_check CHECK (event_type = ANY (ARRAY['created', 'updated', 'owner_changed', 'team_changed', 'stage_changed', 'qualification_updated', 'qualified', 'disqualified', 'reopened', 'converted', 'archived', 'restored', 'merged'])),
  CONSTRAINT crm_lead_history_lead_fkey FOREIGN KEY (organization_id, lead_id) REFERENCES tenant.crm_leads(organization_id, id) ON DELETE CASCADE
);
CREATE INDEX crm_lead_history_lead_idx ON tenant.crm_lead_history (organization_id, lead_id, created_at DESC);

-- ============================================================ 5. row-level security and grants
-- Every lead table is isolated by organization.

ALTER TABLE tenant.crm_lead_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.crm_lead_sources FORCE ROW LEVEL SECURITY;
CREATE POLICY organization_isolation ON tenant.crm_lead_sources USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id());

ALTER TABLE tenant.crm_leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.crm_leads FORCE ROW LEVEL SECURITY;
CREATE POLICY organization_isolation ON tenant.crm_leads USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id());

ALTER TABLE tenant.crm_lead_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.crm_lead_tags FORCE ROW LEVEL SECURITY;
CREATE POLICY organization_isolation ON tenant.crm_lead_tags USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id());

ALTER TABLE tenant.crm_lead_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.crm_lead_history FORCE ROW LEVEL SECURITY;
CREATE POLICY organization_isolation ON tenant.crm_lead_history USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id());


GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE tenant.crm_lead_sources TO vercent_app, vercent_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE tenant.crm_leads TO vercent_app, vercent_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE tenant.crm_lead_tags TO vercent_app, vercent_worker;
GRANT SELECT, INSERT ON TABLE tenant.crm_lead_history TO vercent_app, vercent_worker;

-- ============================================================ 6. links from other CRM tables
-- These tables hold a lead_id or a lead source_id; the links are declared here
-- because the lead tables are created in this file.

ALTER TABLE tenant.crm_opportunities
  ADD CONSTRAINT crm_opportunities_lead_id_organization_fkey FOREIGN KEY (organization_id, lead_id) REFERENCES tenant.crm_leads(organization_id, id) ON DELETE SET NULL (lead_id),
  ADD CONSTRAINT crm_opportunities_source_id_organization_fkey FOREIGN KEY (organization_id, source_id) REFERENCES tenant.crm_lead_sources(organization_id, id) ON DELETE SET NULL (source_id);
ALTER TABLE tenant.crm_capture_forms
  ADD CONSTRAINT crm_capture_forms_source_id_organization_fkey FOREIGN KEY (organization_id, source_id) REFERENCES tenant.crm_lead_sources(organization_id, id) ON DELETE SET NULL (source_id);
ALTER TABLE tenant.crm_communications
  ADD CONSTRAINT crm_communications_lead_id_organization_fkey FOREIGN KEY (organization_id, lead_id) REFERENCES tenant.crm_leads(organization_id, id) ON DELETE SET NULL (lead_id);
ALTER TABLE tenant.crm_email_threads
  ADD CONSTRAINT crm_email_threads_organization_id_lead_id_fkey FOREIGN KEY (organization_id, lead_id) REFERENCES tenant.crm_leads(organization_id, id) ON DELETE SET NULL (lead_id);
ALTER TABLE tenant.crm_calendar_events
  ADD CONSTRAINT crm_calendar_events_organization_id_lead_id_fkey FOREIGN KEY (organization_id, lead_id) REFERENCES tenant.crm_leads(organization_id, id) ON DELETE SET NULL (lead_id);
ALTER TABLE tenant.crm_partner_deals
  ADD CONSTRAINT crm_partner_deals_organization_id_lead_id_fkey FOREIGN KEY (organization_id, lead_id) REFERENCES tenant.crm_leads(organization_id, id) ON DELETE SET NULL (lead_id);
ALTER TABLE tenant.crm_campaign_members
  ADD CONSTRAINT crm_campaign_members_lead_id_organization_fkey FOREIGN KEY (organization_id, lead_id) REFERENCES tenant.crm_leads(organization_id, id) ON DELETE CASCADE;
ALTER TABLE tenant.crm_consent_events
  ADD CONSTRAINT crm_consent_events_lead_id_organization_fkey FOREIGN KEY (organization_id, lead_id) REFERENCES tenant.crm_leads(organization_id, id) ON DELETE CASCADE;
ALTER TABLE tenant.crm_conversations
  ADD CONSTRAINT crm_conversations_organization_id_lead_id_fkey FOREIGN KEY (organization_id, lead_id) REFERENCES tenant.crm_leads(organization_id, id) ON DELETE CASCADE;
ALTER TABLE tenant.crm_playbook_responses
  ADD CONSTRAINT crm_playbook_responses_lead_id_organization_fkey FOREIGN KEY (organization_id, lead_id) REFERENCES tenant.crm_leads(organization_id, id) ON DELETE CASCADE;
ALTER TABLE tenant.crm_sequence_enrollments
  ADD CONSTRAINT crm_sequence_enrollments_lead_id_organization_fkey FOREIGN KEY (organization_id, lead_id) REFERENCES tenant.crm_leads(organization_id, id) ON DELETE CASCADE;

-- ============================================================ 7. permissions
-- One permission per lead action. Which roles hold them is decided by the
-- role templates (packages/permissions/src/roles.js) when an organization is
-- created.

INSERT INTO public.permissions (key, name, category, description) VALUES
  ('crm.leads.view', 'View leads', 'CRM', 'Open the lead list and lead records the user is allowed to see.'),
  ('crm.leads.view_all', 'View all leads', 'CRM', 'See every lead in the organization regardless of owner. Does not widen opportunities, accounts or activities.'),
  ('crm.leads.view_sensitive', 'View lead contact details', 'CRM', 'See lead contact details (email and phone numbers) and lead-linked notes, files and activities.'),
  ('crm.leads.create', 'Create leads', 'CRM', 'Add new leads.'),
  ('crm.leads.edit', 'Edit leads', 'CRM', 'Change lead details, stage, tags, notes and activities.'),
  ('crm.leads.delete', 'Archive leads', 'CRM', 'Archive and restore leads. Leads are never hard-deleted.'),
  ('crm.leads.assign', 'Assign leads', 'CRM', 'Give an unassigned lead an owner or a team.'),
  ('crm.leads.reassign', 'Reassign leads', 'CRM', 'Move a lead that already has an owner to someone else.'),
  ('crm.leads.import', 'Import leads', 'CRM', 'Import leads from a CSV or XLSX file.'),
  ('crm.leads.export', 'Export leads', 'CRM', 'Download the lead list as a file.'),
  ('crm.leads.qualify', 'Qualify leads', 'CRM', 'Mark a lead as qualified.'),
  ('crm.leads.disqualify', 'Disqualify leads', 'CRM', 'Mark a lead as disqualified with a reason.'),
  ('crm.leads.reopen', 'Reopen leads', 'CRM', 'Reopen a qualified or disqualified lead.'),
  ('crm.leads.convert', 'Convert leads', 'CRM', 'Convert a qualified lead into an account, contact and opportunity.')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0005_crm_leads.sql', 'crm-leads');

COMMIT;
