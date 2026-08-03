BEGIN;

ALTER TABLE tenant.business_parties
  ADD COLUMN IF NOT EXISTS parent_party_id uuid,
  ADD COLUMN IF NOT EXISTS privacy_status text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS anonymized_at timestamptz,
  ADD COLUMN IF NOT EXISTS retention_until timestamptz,
  ADD COLUMN IF NOT EXISTS legal_hold boolean NOT NULL DEFAULT false;

ALTER TABLE tenant.contacts
  ADD COLUMN IF NOT EXISTS privacy_status text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS anonymized_at timestamptz,
  ADD COLUMN IF NOT EXISTS retention_until timestamptz,
  ADD COLUMN IF NOT EXISTS legal_hold boolean NOT NULL DEFAULT false;

ALTER TABLE tenant.crm_leads
  ADD COLUMN IF NOT EXISTS privacy_status text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS anonymized_at timestamptz,
  ADD COLUMN IF NOT EXISTS retention_until timestamptz,
  ADD COLUMN IF NOT EXISTS legal_hold boolean NOT NULL DEFAULT false;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='tenant.business_parties'::regclass
      AND conname='business_parties_parent_party_organization_fkey'
  ) THEN
    ALTER TABLE tenant.business_parties
      ADD CONSTRAINT business_parties_parent_party_organization_fkey
      FOREIGN KEY (organization_id,parent_party_id)
      REFERENCES tenant.business_parties(organization_id,id)
      ON DELETE SET NULL (parent_party_id)
      NOT VALID;
  END IF;
END $$;
ALTER TABLE tenant.business_parties VALIDATE CONSTRAINT business_parties_parent_party_organization_fkey;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='tenant.business_parties'::regclass
      AND conname='business_parties_parent_not_self_check'
  ) THEN
    ALTER TABLE tenant.business_parties
      ADD CONSTRAINT business_parties_parent_not_self_check
      CHECK (parent_party_id IS NULL OR parent_party_id<>id) NOT VALID;
  END IF;
END $$;
ALTER TABLE tenant.business_parties VALIDATE CONSTRAINT business_parties_parent_not_self_check;

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['business_parties','contacts','crm_leads'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid=format('tenant.%I',table_name)::regclass
        AND conname=table_name || '_privacy_status_check'
    ) THEN
      EXECUTE format(
        'ALTER TABLE tenant.%I ADD CONSTRAINT %I CHECK (privacy_status IN (''active'',''restricted'',''anonymized'',''erased'')) NOT VALID',
        table_name,table_name || '_privacy_status_check'
      );
      EXECUTE format(
        'ALTER TABLE tenant.%I VALIDATE CONSTRAINT %I',
        table_name,table_name || '_privacy_status_check'
      );
    END IF;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION tenant.prevent_business_party_hierarchy_cycle()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.parent_party_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.parent_party_id=NEW.id THEN
    RAISE EXCEPTION 'An account cannot be its own parent.' USING ERRCODE='23514';
  END IF;
  IF EXISTS (
    WITH RECURSIVE ancestors AS (
      SELECT party.id,party.parent_party_id
      FROM tenant.business_parties party
      WHERE party.organization_id=NEW.organization_id AND party.id=NEW.parent_party_id
      UNION ALL
      SELECT parent.id,parent.parent_party_id
      FROM tenant.business_parties parent
      JOIN ancestors child ON child.parent_party_id=parent.id
      WHERE parent.organization_id=NEW.organization_id
    )
    SELECT 1 FROM ancestors WHERE id=NEW.id
  ) THEN
    RAISE EXCEPTION 'Account hierarchy would contain a cycle.' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS business_parties_hierarchy_cycle_guard ON tenant.business_parties;
CREATE TRIGGER business_parties_hierarchy_cycle_guard
BEFORE INSERT OR UPDATE OF parent_party_id ON tenant.business_parties
FOR EACH ROW EXECUTE FUNCTION tenant.prevent_business_party_hierarchy_cycle();

CREATE TABLE IF NOT EXISTS tenant.crm_account_hierarchy_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  party_id uuid NOT NULL REFERENCES tenant.business_parties(id) ON DELETE RESTRICT,
  previous_parent_party_id uuid REFERENCES tenant.business_parties(id) ON DELETE SET NULL,
  new_parent_party_id uuid REFERENCES tenant.business_parties(id) ON DELETE SET NULL,
  action text NOT NULL CHECK (action IN ('parent_set','parent_cleared','merge_reparented')),
  reason text,
  changed_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  changed_at timestamptz NOT NULL DEFAULT now(),
  CHECK (previous_parent_party_id IS DISTINCT FROM new_parent_party_id)
);

CREATE TABLE IF NOT EXISTS tenant.crm_entity_merge_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  entity_type text NOT NULL CHECK (entity_type IN ('account','contact')),
  source_entity_id uuid NOT NULL,
  survivor_entity_id uuid NOT NULL,
  merge_history_id uuid,
  merged_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  merged_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,entity_type,source_entity_id),
  CHECK (source_entity_id<>survivor_entity_id)
);

CREATE TABLE IF NOT EXISTS tenant.crm_customer_service_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  party_id uuid NOT NULL REFERENCES tenant.business_parties(id) ON DELETE CASCADE,
  contact_id uuid REFERENCES tenant.contacts(id) ON DELETE SET NULL,
  external_system text NOT NULL DEFAULT 'manual',
  external_case_id text,
  event_type text NOT NULL CHECK (event_type IN ('case_opened','case_updated','case_resolved','complaint','service_note','escalation')),
  title text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','pending','resolved','closed')),
  priority text NOT NULL DEFAULT 'medium' CHECK (priority IN ('low','medium','high','urgent')),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,external_system,external_case_id)
);

CREATE TABLE IF NOT EXISTS tenant.crm_privacy_retention_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  subject_type text NOT NULL CHECK (subject_type IN ('lead','contact','party')),
  name text NOT NULL,
  retention_days integer NOT NULL CHECK (retention_days BETWEEN 1 AND 36500),
  action text NOT NULL CHECK (action IN ('restrict','anonymize')),
  status text NOT NULL DEFAULT 'inactive' CHECK (status IN ('active','inactive')),
  last_run_at timestamptz,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,subject_type,name)
);

CREATE TABLE IF NOT EXISTS tenant.crm_privacy_execution_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  privacy_request_id uuid REFERENCES tenant.crm_privacy_requests(id) ON DELETE SET NULL,
  policy_id uuid REFERENCES tenant.crm_privacy_retention_policies(id) ON DELETE SET NULL,
  subject_type text NOT NULL CHECK (subject_type IN ('lead','contact','party')),
  subject_id uuid NOT NULL,
  operation text NOT NULL CHECK (operation IN ('access','export','correction','restrict','anonymize','erase','consent_withdrawal')),
  status text NOT NULL CHECK (status IN ('completed','failed','skipped')),
  result_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  content_hash text NOT NULL,
  executed_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  executed_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tenant.crm_account_intelligence_acceptance_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  capability_id text NOT NULL CHECK (capability_id IN ('CRM-027','CRM-028','CRM-029','CRM-030','CRM-035')),
  status text NOT NULL CHECK (status IN ('passed','failed')),
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  content_hash text NOT NULL,
  commit_sha text,
  recorded_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  recorded_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS crm_privacy_retention_policies_organization_id_id_uidx
  ON tenant.crm_privacy_retention_policies(organization_id,id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='tenant.crm_account_hierarchy_events'::regclass
      AND conname='crm_account_hierarchy_events_party_organization_fkey'
  ) THEN
    ALTER TABLE tenant.crm_account_hierarchy_events
      ADD CONSTRAINT crm_account_hierarchy_events_party_organization_fkey
      FOREIGN KEY (organization_id,party_id)
      REFERENCES tenant.business_parties(organization_id,id) ON DELETE RESTRICT NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='tenant.crm_account_hierarchy_events'::regclass
      AND conname='crm_account_hierarchy_events_previous_parent_organization_fkey'
  ) THEN
    ALTER TABLE tenant.crm_account_hierarchy_events
      ADD CONSTRAINT crm_account_hierarchy_events_previous_parent_organization_fkey
      FOREIGN KEY (organization_id,previous_parent_party_id)
      REFERENCES tenant.business_parties(organization_id,id)
      ON DELETE SET NULL (previous_parent_party_id) NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='tenant.crm_account_hierarchy_events'::regclass
      AND conname='crm_account_hierarchy_events_new_parent_organization_fkey'
  ) THEN
    ALTER TABLE tenant.crm_account_hierarchy_events
      ADD CONSTRAINT crm_account_hierarchy_events_new_parent_organization_fkey
      FOREIGN KEY (organization_id,new_parent_party_id)
      REFERENCES tenant.business_parties(organization_id,id)
      ON DELETE SET NULL (new_parent_party_id) NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='tenant.crm_customer_service_events'::regclass
      AND conname='crm_customer_service_events_company_organization_fkey'
  ) THEN
    ALTER TABLE tenant.crm_customer_service_events
      ADD CONSTRAINT crm_customer_service_events_company_organization_fkey
      FOREIGN KEY (organization_id,company_id)
      REFERENCES public.companies(organization_id,id) ON DELETE CASCADE NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='tenant.crm_customer_service_events'::regclass
      AND conname='crm_customer_service_events_party_organization_fkey'
  ) THEN
    ALTER TABLE tenant.crm_customer_service_events
      ADD CONSTRAINT crm_customer_service_events_party_organization_fkey
      FOREIGN KEY (organization_id,party_id)
      REFERENCES tenant.business_parties(organization_id,id) ON DELETE CASCADE NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='tenant.crm_customer_service_events'::regclass
      AND conname='crm_customer_service_events_contact_organization_fkey'
  ) THEN
    ALTER TABLE tenant.crm_customer_service_events
      ADD CONSTRAINT crm_customer_service_events_contact_organization_fkey
      FOREIGN KEY (organization_id,contact_id)
      REFERENCES tenant.contacts(organization_id,id)
      ON DELETE SET NULL (contact_id) NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='tenant.crm_privacy_execution_runs'::regclass
      AND conname='crm_privacy_execution_runs_request_organization_fkey'
  ) THEN
    ALTER TABLE tenant.crm_privacy_execution_runs
      ADD CONSTRAINT crm_privacy_execution_runs_request_organization_fkey
      FOREIGN KEY (organization_id,privacy_request_id)
      REFERENCES tenant.crm_privacy_requests(organization_id,id)
      ON DELETE SET NULL (privacy_request_id) NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='tenant.crm_privacy_execution_runs'::regclass
      AND conname='crm_privacy_execution_runs_policy_organization_fkey'
  ) THEN
    ALTER TABLE tenant.crm_privacy_execution_runs
      ADD CONSTRAINT crm_privacy_execution_runs_policy_organization_fkey
      FOREIGN KEY (organization_id,policy_id)
      REFERENCES tenant.crm_privacy_retention_policies(organization_id,id)
      ON DELETE SET NULL (policy_id) NOT VALID;
  END IF;
END $$;

ALTER TABLE tenant.crm_account_hierarchy_events
  VALIDATE CONSTRAINT crm_account_hierarchy_events_party_organization_fkey;
ALTER TABLE tenant.crm_account_hierarchy_events
  VALIDATE CONSTRAINT crm_account_hierarchy_events_previous_parent_organization_fkey;
ALTER TABLE tenant.crm_account_hierarchy_events
  VALIDATE CONSTRAINT crm_account_hierarchy_events_new_parent_organization_fkey;
ALTER TABLE tenant.crm_customer_service_events
  VALIDATE CONSTRAINT crm_customer_service_events_company_organization_fkey;
ALTER TABLE tenant.crm_customer_service_events
  VALIDATE CONSTRAINT crm_customer_service_events_party_organization_fkey;
ALTER TABLE tenant.crm_customer_service_events
  VALIDATE CONSTRAINT crm_customer_service_events_contact_organization_fkey;
ALTER TABLE tenant.crm_privacy_execution_runs
  VALIDATE CONSTRAINT crm_privacy_execution_runs_request_organization_fkey;
ALTER TABLE tenant.crm_privacy_execution_runs
  VALIDATE CONSTRAINT crm_privacy_execution_runs_policy_organization_fkey;

CREATE OR REPLACE FUNCTION tenant.crm_account_intelligence_immutable_row()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '% records are immutable',TG_TABLE_NAME;
END;
$$;

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'crm_account_hierarchy_events',
    'crm_privacy_execution_runs',
    'crm_account_intelligence_acceptance_runs'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON tenant.%I',table_name || '_immutable',table_name);
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON tenant.%I FOR EACH ROW EXECUTE FUNCTION tenant.crm_account_intelligence_immutable_row()',
      table_name || '_immutable',table_name
    );
  END LOOP;
END $$;

CREATE INDEX IF NOT EXISTS business_parties_parent_idx ON tenant.business_parties(organization_id,parent_party_id,status);
CREATE INDEX IF NOT EXISTS crm_customer_service_timeline_idx ON tenant.crm_customer_service_events(organization_id,party_id,occurred_at DESC);
CREATE INDEX IF NOT EXISTS crm_privacy_policy_run_idx ON tenant.crm_privacy_retention_policies(organization_id,status,subject_type,last_run_at);
CREATE INDEX IF NOT EXISTS crm_privacy_execution_subject_idx ON tenant.crm_privacy_execution_runs(organization_id,subject_type,subject_id,executed_at DESC);
CREATE INDEX IF NOT EXISTS crm_account_intelligence_acceptance_latest_idx ON tenant.crm_account_intelligence_acceptance_runs(organization_id,capability_id,recorded_at DESC);
CREATE INDEX IF NOT EXISTS business_parties_normalized_name_idx ON tenant.business_parties(organization_id,(regexp_replace(lower(coalesce(legal_name,display_name)),'[^a-z0-9]+','','g'))) WHERE status='active';
CREATE INDEX IF NOT EXISTS contacts_normalized_email_idx ON tenant.contacts(organization_id,(lower(email))) WHERE status='active' AND email IS NOT NULL;
CREATE INDEX IF NOT EXISTS contacts_normalized_phone_idx ON tenant.contacts(organization_id,(right(regexp_replace(coalesce(mobile,phone,''),'\D','','g'),15))) WHERE status='active' AND coalesce(mobile,phone) IS NOT NULL;

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'crm_account_hierarchy_events','crm_entity_merge_aliases','crm_customer_service_events',
    'crm_privacy_retention_policies','crm_privacy_execution_runs','crm_account_intelligence_acceptance_runs'
  ] LOOP
    EXECUTE format('ALTER TABLE tenant.%I ENABLE ROW LEVEL SECURITY',table_name);
    EXECUTE format('ALTER TABLE tenant.%I FORCE ROW LEVEL SECURITY',table_name);
    EXECUTE format('DROP POLICY IF EXISTS organization_isolation ON tenant.%I',table_name);
    EXECUTE format('DROP POLICY IF EXISTS tenant_organization_isolation ON tenant.%I',table_name);
    EXECUTE format(
      'CREATE POLICY tenant_organization_isolation ON tenant.%I USING (organization_id=current_setting(''app.current_organization_id'',true)::uuid) WITH CHECK (organization_id=current_setting(''app.current_organization_id'',true)::uuid)',
      table_name
    );
  END LOOP;
END $$;

REVOKE UPDATE,DELETE ON tenant.crm_account_hierarchy_events FROM PUBLIC;
REVOKE UPDATE,DELETE ON tenant.crm_entity_merge_aliases FROM PUBLIC;
REVOKE UPDATE,DELETE ON tenant.crm_privacy_execution_runs FROM PUBLIC;
REVOKE UPDATE,DELETE ON tenant.crm_account_intelligence_acceptance_runs FROM PUBLIC;

INSERT INTO tenant.crm_privacy_retention_policies(
  organization_id,subject_type,name,retention_days,action,status,created_by,updated_by
)
SELECT organization.id,seed.subject_type,seed.name,seed.retention_days,seed.action,'inactive',organization.created_by,organization.created_by
FROM public.organizations organization
CROSS JOIN (VALUES
  ('lead','Inactive lead retention',730,'anonymize'),
  ('contact','Inactive contact retention',2555,'anonymize'),
  ('party','Inactive account retention',2555,'restrict')
) AS seed(subject_type,name,retention_days,action)
ON CONFLICT (organization_id,subject_type,name) DO NOTHING;

COMMIT;
