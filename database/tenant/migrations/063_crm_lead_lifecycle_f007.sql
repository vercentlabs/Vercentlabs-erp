BEGIN;

-- F007 intentionally keeps Lead lifecycle independent from Opportunity sales
-- stages, F006 qualification, conversion and archival state.
CREATE TABLE IF NOT EXISTS tenant.crm_lead_stages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  description text,
  sort_order integer NOT NULL DEFAULT 100,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  is_system boolean NOT NULL DEFAULT false,
  is_initial boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,id),
  UNIQUE (organization_id,code),
  CHECK (code ~ '^[a-z][a-z0-9_]{0,63}$'),
  CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  CHECK (description IS NULL OR length(description) <= 1000),
  CHECK (sort_order BETWEEN 0 AND 100000),
  CHECK (NOT is_initial OR status='active')
);

CREATE UNIQUE INDEX IF NOT EXISTS crm_lead_stages_normalized_name_uidx
  ON tenant.crm_lead_stages(organization_id,lower(btrim(name)));
CREATE UNIQUE INDEX IF NOT EXISTS crm_lead_stages_one_initial_uidx
  ON tenant.crm_lead_stages(organization_id) WHERE is_initial;
CREATE INDEX IF NOT EXISTS crm_lead_stages_catalogue_idx
  ON tenant.crm_lead_stages(organization_id,status,sort_order,id);

INSERT INTO tenant.crm_lead_stages(
  organization_id,code,name,description,sort_order,status,is_system,is_initial
)
SELECT organization.id, seed.code, seed.name, seed.description, seed.sort_order,
       'active', true, seed.code='new'
FROM public.organizations organization
CROSS JOIN (VALUES
  ('new','New','Captured and awaiting first engagement.',10),
  ('contacted','Contacted','Initial outreach has been made.',20),
  ('working','Working','Active follow-up or discovery is underway.',30)
) AS seed(code,name,description,sort_order)
ON CONFLICT (organization_id,code) DO NOTHING;

CREATE TABLE IF NOT EXISTS tenant.crm_lead_stage_transitions (
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  from_stage_id uuid NOT NULL,
  to_stage_id uuid NOT NULL,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id,from_stage_id,to_stage_id),
  FOREIGN KEY (organization_id,from_stage_id)
    REFERENCES tenant.crm_lead_stages(organization_id,id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id,to_stage_id)
    REFERENCES tenant.crm_lead_stages(organization_id,id) ON DELETE CASCADE,
  CHECK (from_stage_id<>to_stage_id)
);

-- The default graph is deliberately explicit and adjacent. Configuration
-- operations rebuild the same bidirectional adjacent graph deterministically.
INSERT INTO tenant.crm_lead_stage_transitions(organization_id,from_stage_id,to_stage_id)
SELECT current.organization_id,current.id,next.id
FROM tenant.crm_lead_stages current
JOIN tenant.crm_lead_stages next
  ON next.organization_id=current.organization_id
 AND ((current.code='new' AND next.code='contacted')
   OR (current.code='contacted' AND next.code IN ('new','working'))
   OR (current.code='working' AND next.code='contacted'))
ON CONFLICT DO NOTHING;

ALTER TABLE tenant.crm_leads
  ADD COLUMN IF NOT EXISTS record_status text NOT NULL DEFAULT 'active';

UPDATE tenant.crm_leads
SET record_status=CASE status
      WHEN 'archived' THEN 'archived'
      WHEN 'converted' THEN 'converted'
      ELSE 'active'
    END,
    status=CASE WHEN status IN ('archived','converted') THEN 'working' ELSE status END;

ALTER TABLE tenant.crm_leads
  DROP CONSTRAINT IF EXISTS crm_leads_status_check,
  DROP CONSTRAINT IF EXISTS crm_leads_record_status_check,
  ADD CONSTRAINT crm_leads_record_status_check
    CHECK (record_status IN ('active','archived','converted')),
  ADD CONSTRAINT crm_leads_lifecycle_stage_fkey
    FOREIGN KEY (organization_id,status)
    REFERENCES tenant.crm_lead_stages(organization_id,code) ON UPDATE RESTRICT ON DELETE RESTRICT;

DROP INDEX IF EXISTS tenant.crm_leads_owner_active_idx;
CREATE INDEX crm_leads_owner_active_idx
  ON tenant.crm_leads(organization_id,owner_user_id,status)
  WHERE record_status='active';
CREATE INDEX IF NOT EXISTS crm_leads_record_status_idx
  ON tenant.crm_leads(organization_id,record_status,updated_at DESC);

CREATE TABLE IF NOT EXISTS tenant.crm_lead_stage_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL,
  from_stage_id uuid NOT NULL,
  to_stage_id uuid NOT NULL,
  from_stage_code text NOT NULL,
  to_stage_code text NOT NULL,
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','kanban','api','legacy')),
  note text,
  changed_by_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,id),
  FOREIGN KEY (organization_id,lead_id)
    REFERENCES tenant.crm_leads(organization_id,id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id,from_stage_id)
    REFERENCES tenant.crm_lead_stages(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id,to_stage_id)
    REFERENCES tenant.crm_lead_stages(organization_id,id) ON DELETE RESTRICT,
  CHECK (from_stage_id<>to_stage_id),
  CHECK (from_stage_code<>to_stage_code),
  CHECK (note IS NULL OR length(note)<=1000)
);
CREATE INDEX IF NOT EXISTS crm_lead_stage_events_lead_idx
  ON tenant.crm_lead_stage_events(organization_id,lead_id,created_at DESC,id DESC);

CREATE OR REPLACE FUNCTION tenant.crm_lead_stage_event_immutable()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' AND pg_trigger_depth()>1 THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'Lead lifecycle history is immutable';
END;
$$;
DROP TRIGGER IF EXISTS crm_lead_stage_events_immutable ON tenant.crm_lead_stage_events;
CREATE TRIGGER crm_lead_stage_events_immutable
BEFORE UPDATE OR DELETE ON tenant.crm_lead_stage_events
FOR EACH ROW EXECUTE FUNCTION tenant.crm_lead_stage_event_immutable();

CREATE OR REPLACE FUNCTION tenant.crm_lead_stage_write_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status
     AND current_setting('app.crm_lead_stage_transition',true)<>'allowed' THEN
    RAISE EXCEPTION 'Use the governed Lead lifecycle transition service'
      USING ERRCODE='P0001';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS crm_leads_stage_write_guard ON tenant.crm_leads;
CREATE TRIGGER crm_leads_stage_write_guard
BEFORE UPDATE OF status ON tenant.crm_leads
FOR EACH ROW EXECUTE FUNCTION tenant.crm_lead_stage_write_guard();

ALTER TABLE tenant.crm_lead_stages ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.crm_lead_stages FORCE ROW LEVEL SECURITY;
ALTER TABLE tenant.crm_lead_stage_transitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.crm_lead_stage_transitions FORCE ROW LEVEL SECURITY;
ALTER TABLE tenant.crm_lead_stage_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.crm_lead_stage_events FORCE ROW LEVEL SECURITY;
DO $$ DECLARE table_name text; BEGIN
  FOREACH table_name IN ARRAY ARRAY['crm_lead_stages','crm_lead_stage_transitions','crm_lead_stage_events'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS tenant_organization_isolation ON tenant.%I',table_name);
    EXECUTE format('CREATE POLICY tenant_organization_isolation ON tenant.%I USING (organization_id=current_setting(''app.current_organization_id'',true)::uuid) WITH CHECK (organization_id=current_setting(''app.current_organization_id'',true)::uuid)',table_name);
  END LOOP;
END $$;

COMMENT ON TABLE tenant.crm_lead_stages IS 'Canonical F007 organization-wide Lead lifecycle catalogue; not Opportunity sales stages.';
COMMENT ON COLUMN tenant.crm_leads.status IS 'Stable F007 Lead lifecycle stage code; independent from qualification and record_status.';
COMMENT ON COLUMN tenant.crm_leads.record_status IS 'Retention/conversion state; independent from Lead lifecycle.';
COMMENT ON TABLE tenant.crm_lead_stage_events IS 'Immutable F007 Lead lifecycle transition ledger.';

COMMIT;
