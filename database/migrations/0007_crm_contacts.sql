-- CRM Contacts: the people the organization deals with.
--
-- A contact is a person. Their links to companies live in
-- tenant.crm_contact_account_relationships — one row per account, each with
-- its own job title, department, role, decision-maker flag and active /
-- inactive state — so a person who changes employer keeps their history and
-- can belong to more than one business. One active relationship is the
-- contact's primary company; the contact row carries a copy of that
-- relationship (party_id, job title, department, role, decision maker,
-- primary contact), kept in step by a trigger, so lists and other modules
-- read one row.
--
-- Communication details are separate fields (work / secondary email, work
-- phone, mobile, alternate phone) with a preferred method and lightweight
-- do-not-contact preferences. Each contact has an owner and an optional team
-- (Own / Team / All visibility) and an append-only history.

SELECT pg_catalog.set_config('search_path', '', false);

-- ============================================================ 1. contact fields

ALTER TABLE tenant.contacts
  ADD COLUMN contact_number text,
  ADD COLUMN middle_name text,
  ADD COLUMN display_name text,
  ADD COLUMN secondary_email text,
  ADD COLUMN alternate_phone text,
  ADD COLUMN preferred_contact_method text,
  ADD COLUMN contact_role text,
  ADD COLUMN owner_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN team_id uuid,
  ADD COLUMN assigned_at timestamp with time zone,
  ADD COLUMN source_id uuid,
  ADD COLUMN description text,
  ADD COLUMN last_activity_at timestamp with time zone,
  ADD COLUMN do_not_email boolean DEFAULT false NOT NULL,
  ADD COLUMN do_not_call boolean DEFAULT false NOT NULL,
  ADD COLUMN do_not_sms boolean DEFAULT false NOT NULL,
  ADD COLUMN marketing_consent text DEFAULT 'unknown' NOT NULL,
  -- the contact's own address; by default the company address applies
  ADD COLUMN use_account_address boolean DEFAULT true NOT NULL,
  ADD COLUMN address_line1 text,
  ADD COLUMN address_line2 text,
  ADD COLUMN city text,
  ADD COLUMN state text,
  ADD COLUMN postal_code text,
  ADD COLUMN country_code text,
  ADD COLUMN archived_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  -- duplicate detection on the other channels (email and mobile already exist)
  ADD COLUMN normalized_secondary_email text GENERATED ALWAYS AS (tenant.crm_normalize_email(secondary_email)) STORED,
  ADD COLUMN normalized_work_phone text GENERATED ALWAYS AS (tenant.crm_normalize_phone(phone)) STORED,
  ADD COLUMN normalized_alternate_phone text GENERATED ALWAYS AS (tenant.crm_normalize_phone(alternate_phone)) STORED,
  ADD CONSTRAINT contacts_first_name_present_check CHECK (btrim(first_name) <> ''),
  ADD CONSTRAINT contacts_preferred_method_check CHECK (preferred_contact_method IS NULL OR preferred_contact_method = ANY (ARRAY['email', 'phone', 'mobile', 'other'])),
  ADD CONSTRAINT contacts_role_check CHECK (contact_role IS NULL OR contact_role = ANY (ARRAY[
    'decision_maker', 'influencer', 'champion', 'procurement', 'finance', 'technical', 'operations', 'user', 'executive',
    'billing', 'shipping', 'support', 'other'])),
  ADD CONSTRAINT contacts_marketing_consent_check CHECK (marketing_consent = ANY (ARRAY['unknown', 'opted_in', 'opted_out'])),
  ADD CONSTRAINT contacts_country_code_check CHECK (country_code IS NULL OR country_code ~ '^[A-Z]{2}$'),
  ADD CONSTRAINT contacts_archive_check CHECK ((status = 'archived') = (archived_at IS NOT NULL)),
  ADD CONSTRAINT contacts_team_id_organization_fkey FOREIGN KEY (organization_id, team_id) REFERENCES tenant.crm_sales_teams(organization_id, id) ON DELETE SET NULL (team_id),
  ADD CONSTRAINT contacts_source_id_organization_fkey FOREIGN KEY (organization_id, source_id) REFERENCES tenant.crm_lead_sources(organization_id, id) ON DELETE SET NULL (source_id);

CREATE UNIQUE INDEX contacts_contact_number_uidx ON tenant.contacts (organization_id, contact_number) WHERE contact_number IS NOT NULL;
CREATE INDEX contacts_owner_idx ON tenant.contacts (organization_id, owner_user_id, status);
CREATE INDEX contacts_team_idx ON tenant.contacts (organization_id, team_id) WHERE team_id IS NOT NULL;
CREATE INDEX contacts_secondary_email_idx ON tenant.contacts (organization_id, normalized_secondary_email) WHERE normalized_secondary_email IS NOT NULL;
CREATE INDEX contacts_work_phone_idx ON tenant.contacts (organization_id, normalized_work_phone) WHERE normalized_work_phone IS NOT NULL;
CREATE INDEX contacts_alternate_phone_idx ON tenant.contacts (organization_id, normalized_alternate_phone) WHERE normalized_alternate_phone IS NOT NULL;
CREATE INDEX contacts_search_idx ON tenant.contacts USING gin (
  lower(COALESCE(contact_number, '') || ' ' || COALESCE(display_name, '') || ' ' || first_name || ' ' || COALESCE(middle_name, '') || ' ' || COALESCE(last_name, '') || ' '
    || COALESCE(designation, '') || ' ' || COALESCE(email, '') || ' ' || COALESCE(secondary_email, '') || ' ' || COALESCE(phone, '') || ' '
    || COALESCE(mobile, '') || ' ' || COALESCE(alternate_phone, '')) public.gin_trgm_ops);

-- ============================================================ 2. account <-> contact relationships

CREATE TABLE tenant.crm_contact_account_relationships (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL,
  party_id uuid NOT NULL,
  job_title text,
  department text,
  role text,
  -- this account is the contact's primary company
  is_primary_account boolean DEFAULT false NOT NULL,
  -- this contact is the account's primary contact
  is_primary_contact boolean DEFAULT false NOT NULL,
  is_decision_maker boolean DEFAULT false NOT NULL,
  status text DEFAULT 'active' NOT NULL,
  ended_at timestamp with time zone,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT crm_contact_account_relationships_status_check CHECK (status = ANY (ARRAY['active', 'inactive'])),
  CONSTRAINT crm_contact_account_relationships_role_check CHECK (role IS NULL OR role = ANY (ARRAY[
    'decision_maker', 'influencer', 'champion', 'procurement', 'finance', 'technical', 'operations', 'user', 'executive',
    'billing', 'shipping', 'support', 'other'])),
  -- an inactive relationship (the person left) is never primary
  CONSTRAINT crm_contact_account_relationships_primary_active_check CHECK (status = 'active' OR (NOT is_primary_account AND NOT is_primary_contact)),
  CONSTRAINT crm_contact_account_relationships_contact_party_key UNIQUE (organization_id, contact_id, party_id),
  CONSTRAINT crm_contact_account_relationships_contact_fkey FOREIGN KEY (organization_id, contact_id) REFERENCES tenant.contacts(organization_id, id) ON DELETE CASCADE,
  CONSTRAINT crm_contact_account_relationships_party_fkey FOREIGN KEY (organization_id, party_id) REFERENCES tenant.business_parties(organization_id, id) ON DELETE CASCADE
);
-- one primary company per contact, one primary contact per account
CREATE UNIQUE INDEX crm_contact_account_relationships_primary_account_uidx ON tenant.crm_contact_account_relationships (organization_id, contact_id) WHERE is_primary_account;
CREATE UNIQUE INDEX crm_contact_account_relationships_primary_contact_uidx ON tenant.crm_contact_account_relationships (organization_id, party_id) WHERE is_primary_contact;
CREATE INDEX crm_contact_account_relationships_party_idx ON tenant.crm_contact_account_relationships (organization_id, party_id, status);
CREATE INDEX crm_contact_account_relationships_contact_idx ON tenant.crm_contact_account_relationships (organization_id, contact_id, status);

-- The contact row mirrors its primary company relationship.
CREATE FUNCTION tenant.crm_contact_primary_account_sync() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE
  target uuid := COALESCE(NEW.contact_id, OLD.contact_id);
  organization uuid := COALESCE(NEW.organization_id, OLD.organization_id);
  primary_row tenant.crm_contact_account_relationships%ROWTYPE;
BEGIN
  SELECT * INTO primary_row FROM tenant.crm_contact_account_relationships
   WHERE organization_id = organization AND contact_id = target AND is_primary_account AND status = 'active';
  IF FOUND THEN
    UPDATE tenant.contacts
       SET party_id = primary_row.party_id, designation = primary_row.job_title, department = primary_row.department,
           contact_role = primary_row.role, is_decision_maker = primary_row.is_decision_maker, is_primary = primary_row.is_primary_contact
     WHERE organization_id = organization AND id = target
       AND (party_id, designation, department, contact_role, is_decision_maker, is_primary)
           IS DISTINCT FROM (primary_row.party_id, primary_row.job_title, primary_row.department, primary_row.role, primary_row.is_decision_maker, primary_row.is_primary_contact);
  ELSE
    -- No company: the person keeps their own job title, department and role.
    UPDATE tenant.contacts SET party_id = NULL, is_primary = false
     WHERE organization_id = organization AND id = target AND (party_id IS NOT NULL OR is_primary);
  END IF;
  RETURN NULL;
END;
$$;
CREATE TRIGGER crm_contact_account_relationships_sync AFTER INSERT OR UPDATE OR DELETE ON tenant.crm_contact_account_relationships
  FOR EACH ROW EXECUTE FUNCTION tenant.crm_contact_primary_account_sync();
CREATE TRIGGER crm_contact_account_relationships_touch BEFORE UPDATE ON tenant.crm_contact_account_relationships
  FOR EACH ROW EXECUTE FUNCTION tenant.touch_updated_at();

-- ============================================================ 3. activities name the account too
-- A call or follow-up logged on a contact also belongs to the company they
-- worked for at the time, even if they later move.

ALTER TABLE tenant.crm_activities
  ADD COLUMN related_party_id uuid,
  ADD CONSTRAINT crm_activities_related_party_organization_fkey FOREIGN KEY (organization_id, related_party_id) REFERENCES tenant.business_parties(organization_id, id) ON DELETE SET NULL (related_party_id);
CREATE INDEX crm_activities_related_party_idx ON tenant.crm_activities (organization_id, related_party_id) WHERE related_party_id IS NOT NULL;

-- ============================================================ 4. contact history

CREATE TABLE tenant.crm_contact_history (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL,
  event_type text NOT NULL,
  summary text NOT NULL,
  changes jsonb DEFAULT '{}'::jsonb NOT NULL,
  actor_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT crm_contact_history_event_type_check CHECK (event_type = ANY (ARRAY[
    'created', 'updated', 'owner_changed', 'team_changed', 'account_linked', 'account_unlinked', 'account_changed', 'relationship_updated',
    'primary_contact_set', 'opportunity_associated', 'customer_association', 'lead_converted', 'merged', 'deactivated', 'reactivated', 'archived'])),
  CONSTRAINT crm_contact_history_contact_organization_fkey FOREIGN KEY (organization_id, contact_id) REFERENCES tenant.contacts(organization_id, id) ON DELETE CASCADE
);
CREATE INDEX crm_contact_history_contact_idx ON tenant.crm_contact_history (organization_id, contact_id, created_at DESC);

CREATE TABLE tenant.crm_contact_tags (
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL,
  tag_id uuid NOT NULL,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT crm_contact_tags_pkey PRIMARY KEY (organization_id, contact_id, tag_id),
  CONSTRAINT crm_contact_tags_contact_organization_fkey FOREIGN KEY (organization_id, contact_id) REFERENCES tenant.contacts(organization_id, id) ON DELETE CASCADE,
  CONSTRAINT crm_contact_tags_tag_organization_fkey FOREIGN KEY (organization_id, tag_id) REFERENCES tenant.crm_tags(organization_id, id) ON DELETE CASCADE
);
CREATE INDEX crm_contact_tags_tag_idx ON tenant.crm_contact_tags (organization_id, tag_id);

-- ============================================================ 5. row-level security and grants

ALTER TABLE tenant.crm_contact_account_relationships ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.crm_contact_account_relationships FORCE ROW LEVEL SECURITY;
CREATE POLICY organization_isolation ON tenant.crm_contact_account_relationships USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id());
ALTER TABLE tenant.crm_contact_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.crm_contact_history FORCE ROW LEVEL SECURITY;
CREATE POLICY organization_isolation ON tenant.crm_contact_history USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id());
ALTER TABLE tenant.crm_contact_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.crm_contact_tags FORCE ROW LEVEL SECURITY;
CREATE POLICY organization_isolation ON tenant.crm_contact_tags USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE tenant.crm_contact_account_relationships TO vercent_app, vercent_worker;
GRANT SELECT, INSERT ON TABLE tenant.crm_contact_history TO vercent_app, vercent_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE tenant.crm_contact_tags TO vercent_app, vercent_worker;
GRANT EXECUTE ON FUNCTION tenant.crm_contact_primary_account_sync() TO vercent_app, vercent_worker;

-- ============================================================ 6. existing contacts become relationships

INSERT INTO tenant.crm_contact_account_relationships (organization_id, contact_id, party_id, job_title, department, is_primary_account, is_primary_contact, is_decision_maker, status)
SELECT organization_id, id, party_id, designation, department, status = 'active', is_primary AND status = 'active', is_decision_maker, CASE WHEN status = 'active' THEN 'active' ELSE 'inactive' END
  FROM tenant.contacts WHERE party_id IS NOT NULL
ON CONFLICT DO NOTHING;
UPDATE tenant.contacts SET display_name = btrim(first_name || ' ' || COALESCE(last_name, '')) WHERE display_name IS NULL;

-- ============================================================ 7. permissions

INSERT INTO public.permissions (key, name, category, description) VALUES
  ('crm.contacts.view', 'View contacts', 'CRM', 'Open the contact list and the contacts the user is allowed to see.'),
  ('crm.contacts.view_all', 'View all contacts', 'CRM', 'See every contact in the organization regardless of owner.'),
  ('crm.contacts.create', 'Create contacts', 'CRM', 'Add new contacts.'),
  ('crm.contacts.edit', 'Edit contacts', 'CRM', 'Change contact details, company relationships, notes and activities.'),
  ('crm.contacts.archive', 'Archive contacts', 'CRM', 'Deactivate, reactivate and archive contacts.'),
  ('crm.contacts.delete', 'Delete unused contacts', 'CRM', 'Permanently delete a contact that has no history.'),
  ('crm.contacts.assign', 'Assign contacts', 'CRM', 'Give an unowned contact an owner or a team.'),
  ('crm.contacts.reassign', 'Reassign contacts', 'CRM', 'Move a contact that already has an owner to someone else.'),
  ('crm.contacts.merge', 'Merge contacts', 'CRM', 'Merge a duplicate contact into another contact.'),
  ('crm.contacts.import', 'Import contacts', 'CRM', 'Import contacts from a CSV or XLSX file.'),
  ('crm.contacts.export', 'Export contacts', 'CRM', 'Download the contact list as a file.')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0007_crm_contacts.sql', 'crm-contacts');
