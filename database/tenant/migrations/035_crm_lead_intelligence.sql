BEGIN;

CREATE TABLE IF NOT EXISTS tenant.crm_lead_scoring_models (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  name text NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','retired')),
  base_score integer NOT NULL DEFAULT 0 CHECK (base_score BETWEEN -10000 AND 10000),
  score_floor integer NOT NULL DEFAULT -100 CHECK (score_floor BETWEEN -10000 AND 10000),
  score_ceiling integer NOT NULL DEFAULT 100 CHECK (score_ceiling BETWEEN -10000 AND 10000),
  decay_half_life_days integer NOT NULL DEFAULT 30 CHECK (decay_half_life_days BETWEEN 1 AND 3650),
  qualification_thresholds jsonb NOT NULL DEFAULT '{"warm":30,"hot":60,"qualified":75}'::jsonb,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  activated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, name, version),
  CHECK (score_floor < score_ceiling)
);

CREATE UNIQUE INDEX IF NOT EXISTS crm_lead_scoring_models_one_active_idx
  ON tenant.crm_lead_scoring_models(organization_id)
  WHERE status='active';

CREATE TABLE IF NOT EXISTS tenant.crm_lead_scoring_model_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  model_id uuid NOT NULL REFERENCES tenant.crm_lead_scoring_models(id) ON DELETE CASCADE,
  name text NOT NULL,
  sequence integer NOT NULL DEFAULT 100 CHECK (sequence > 0),
  signal_type text NOT NULL CHECK (signal_type IN ('demographic','firmographic','behavioral','negative')),
  predicate jsonb NOT NULL DEFAULT '{}'::jsonb,
  points integer NOT NULL CHECK (points BETWEEN -1000 AND 1000),
  maximum_occurrences integer CHECK (maximum_occurrences IS NULL OR maximum_occurrences > 0),
  decay_enabled boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, model_id, name)
);

CREATE TABLE IF NOT EXISTS tenant.crm_lead_behavior_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES tenant.crm_leads(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  event_value numeric(18,4),
  source_type text NOT NULL DEFAULT 'crm' CHECK (source_type IN ('crm','email','website','form','marketing','product','event','integration','manual')),
  source_id text,
  idempotency_key text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  received_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  UNIQUE (organization_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS crm_lead_behavior_events_lead_idx
  ON tenant.crm_lead_behavior_events(organization_id,lead_id,occurred_at DESC);

CREATE TABLE IF NOT EXISTS tenant.crm_lead_score_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES tenant.crm_leads(id) ON DELETE CASCADE,
  model_id uuid NOT NULL REFERENCES tenant.crm_lead_scoring_models(id) ON DELETE RESTRICT,
  score integer NOT NULL CHECK (score BETWEEN -10000 AND 10000),
  grade text NOT NULL CHECK (grade IN ('cold','warm','hot','qualified')),
  contributions jsonb NOT NULL DEFAULT '[]'::jsonb,
  explanation jsonb NOT NULL DEFAULT '{}'::jsonb,
  content_hash text NOT NULL,
  calculated_at timestamptz NOT NULL DEFAULT now(),
  calculated_by uuid REFERENCES public.users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS crm_lead_score_snapshots_lead_idx
  ON tenant.crm_lead_score_snapshots(organization_id,lead_id,calculated_at DESC);

ALTER TABLE tenant.crm_leads
  ADD COLUMN IF NOT EXISTS lead_grade text NOT NULL DEFAULT 'cold' CHECK (lead_grade IN ('cold','warm','hot','qualified')),
  ADD COLUMN IF NOT EXISTS score_model_id uuid REFERENCES tenant.crm_lead_scoring_models(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS score_calculated_at timestamptz,
  ADD COLUMN IF NOT EXISTS score_explanation jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS tenant.crm_lead_sla_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  name text NOT NULL,
  sequence integer NOT NULL DEFAULT 100 CHECK (sequence > 0),
  criteria jsonb NOT NULL DEFAULT '{}'::jsonb,
  first_response_minutes integer NOT NULL CHECK (first_response_minutes BETWEEN 1 AND 43200),
  escalation_after_minutes integer NOT NULL DEFAULT 30 CHECK (escalation_after_minutes BETWEEN 0 AND 43200),
  business_hours jsonb NOT NULL DEFAULT '{"timezone":"Asia/Kolkata","weekdays":[1,2,3,4,5],"start":"09:00","end":"18:00"}'::jsonb,
  escalation_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  reassign_on_breach boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, name)
);

CREATE TABLE IF NOT EXISTS tenant.crm_lead_sla_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES tenant.crm_leads(id) ON DELETE CASCADE,
  policy_id uuid NOT NULL REFERENCES tenant.crm_lead_sla_policies(id) ON DELETE RESTRICT,
  owner_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  response_due_at timestamptz NOT NULL,
  first_responded_at timestamptz,
  breached_at timestamptz,
  escalated_at timestamptz,
  paused_at timestamptz,
  pause_reason text,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','paused','compliant','breached','cancelled')),
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS crm_lead_sla_cases_active_idx
  ON tenant.crm_lead_sla_cases(organization_id,lead_id)
  WHERE status IN ('open','paused','breached');
CREATE INDEX IF NOT EXISTS crm_lead_sla_cases_due_idx
  ON tenant.crm_lead_sla_cases(organization_id,status,response_due_at);

CREATE TABLE IF NOT EXISTS tenant.crm_lead_sla_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  sla_case_id uuid NOT NULL REFERENCES tenant.crm_lead_sla_cases(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES tenant.crm_leads(id) ON DELETE CASCADE,
  event_type text NOT NULL CHECK (event_type IN ('started','paused','resumed','responded','breached','escalated','reassigned','cancelled')),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS tenant.crm_lead_nurture_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  name text NOT NULL,
  sequence integer NOT NULL DEFAULT 100 CHECK (sequence > 0),
  criteria jsonb NOT NULL DEFAULT '{}'::jsonb,
  minimum_score integer NOT NULL DEFAULT -10000,
  maximum_score integer NOT NULL DEFAULT 74,
  inactivity_days integer NOT NULL DEFAULT 3 CHECK (inactivity_days BETWEEN 0 AND 3650),
  action_type text NOT NULL DEFAULT 'call' CHECK (action_type IN ('call','email','sms','whatsapp','task','meeting','review')),
  action_template jsonb NOT NULL DEFAULT '{}'::jsonb,
  consent_channel text NOT NULL DEFAULT 'any' CHECK (consent_channel IN ('any','email','sms','whatsapp','call')),
  reentry_days integer NOT NULL DEFAULT 7 CHECK (reentry_days BETWEEN 0 AND 3650),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (minimum_score <= maximum_score),
  UNIQUE (organization_id, name)
);

CREATE TABLE IF NOT EXISTS tenant.crm_lead_nurture_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES tenant.crm_leads(id) ON DELETE CASCADE,
  policy_id uuid NOT NULL REFERENCES tenant.crm_lead_nurture_policies(id) ON DELETE RESTRICT,
  owner_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  priority_score numeric(12,4) NOT NULL DEFAULT 0,
  recommended_action text NOT NULL,
  reason_codes jsonb NOT NULL DEFAULT '[]'::jsonb,
  due_at timestamptz NOT NULL,
  claimed_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  claimed_at timestamptz,
  completed_at timestamptz,
  snoozed_until timestamptz,
  exited_at timestamptz,
  exit_reason text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','claimed','snoozed','completed','exited','cancelled')),
  last_generated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS crm_lead_nurture_queue_open_idx
  ON tenant.crm_lead_nurture_queue(organization_id,lead_id)
  WHERE status IN ('active','claimed','snoozed');
CREATE INDEX IF NOT EXISTS crm_lead_nurture_queue_priority_idx
  ON tenant.crm_lead_nurture_queue(organization_id,status,priority_score DESC,due_at);


CREATE UNIQUE INDEX IF NOT EXISTS crm_lead_scoring_models_organization_id_id_uidx ON tenant.crm_lead_scoring_models(organization_id,id);
CREATE UNIQUE INDEX IF NOT EXISTS crm_lead_scoring_model_rules_organization_id_id_uidx ON tenant.crm_lead_scoring_model_rules(organization_id,id);
CREATE UNIQUE INDEX IF NOT EXISTS crm_lead_behavior_events_organization_id_id_uidx ON tenant.crm_lead_behavior_events(organization_id,id);
CREATE UNIQUE INDEX IF NOT EXISTS crm_lead_score_snapshots_organization_id_id_uidx ON tenant.crm_lead_score_snapshots(organization_id,id);
CREATE UNIQUE INDEX IF NOT EXISTS crm_lead_sla_policies_organization_id_id_uidx ON tenant.crm_lead_sla_policies(organization_id,id);
CREATE UNIQUE INDEX IF NOT EXISTS crm_lead_sla_cases_organization_id_id_uidx ON tenant.crm_lead_sla_cases(organization_id,id);
CREATE UNIQUE INDEX IF NOT EXISTS crm_lead_sla_events_organization_id_id_uidx ON tenant.crm_lead_sla_events(organization_id,id);
CREATE UNIQUE INDEX IF NOT EXISTS crm_lead_nurture_policies_organization_id_id_uidx ON tenant.crm_lead_nurture_policies(organization_id,id);
CREATE UNIQUE INDEX IF NOT EXISTS crm_lead_nurture_queue_organization_id_id_uidx ON tenant.crm_lead_nurture_queue(organization_id,id);

ALTER TABLE tenant.crm_lead_scoring_model_rules DROP CONSTRAINT IF EXISTS crm_lead_scoring_model_rules_model_id_fkey;
ALTER TABLE tenant.crm_lead_scoring_model_rules ADD CONSTRAINT crm_lead_scoring_model_rules_model_organization_fkey FOREIGN KEY (organization_id,model_id) REFERENCES tenant.crm_lead_scoring_models(organization_id,id) ON DELETE CASCADE NOT VALID;
ALTER TABLE tenant.crm_lead_scoring_model_rules VALIDATE CONSTRAINT crm_lead_scoring_model_rules_model_organization_fkey;
ALTER TABLE tenant.crm_lead_behavior_events DROP CONSTRAINT IF EXISTS crm_lead_behavior_events_lead_id_fkey;
ALTER TABLE tenant.crm_lead_behavior_events ADD CONSTRAINT crm_lead_behavior_events_lead_organization_fkey FOREIGN KEY (organization_id,lead_id) REFERENCES tenant.crm_leads(organization_id,id) ON DELETE CASCADE NOT VALID;
ALTER TABLE tenant.crm_lead_behavior_events VALIDATE CONSTRAINT crm_lead_behavior_events_lead_organization_fkey;
ALTER TABLE tenant.crm_lead_score_snapshots DROP CONSTRAINT IF EXISTS crm_lead_score_snapshots_lead_id_fkey;
ALTER TABLE tenant.crm_lead_score_snapshots DROP CONSTRAINT IF EXISTS crm_lead_score_snapshots_model_id_fkey;
ALTER TABLE tenant.crm_lead_score_snapshots ADD CONSTRAINT crm_lead_score_snapshots_lead_organization_fkey FOREIGN KEY (organization_id,lead_id) REFERENCES tenant.crm_leads(organization_id,id) ON DELETE CASCADE NOT VALID;
ALTER TABLE tenant.crm_lead_score_snapshots ADD CONSTRAINT crm_lead_score_snapshots_model_organization_fkey FOREIGN KEY (organization_id,model_id) REFERENCES tenant.crm_lead_scoring_models(organization_id,id) ON DELETE RESTRICT NOT VALID;
ALTER TABLE tenant.crm_lead_score_snapshots VALIDATE CONSTRAINT crm_lead_score_snapshots_lead_organization_fkey;
ALTER TABLE tenant.crm_lead_score_snapshots VALIDATE CONSTRAINT crm_lead_score_snapshots_model_organization_fkey;
ALTER TABLE tenant.crm_leads DROP CONSTRAINT IF EXISTS crm_leads_score_model_id_fkey;
ALTER TABLE tenant.crm_leads ADD CONSTRAINT crm_leads_score_model_organization_fkey FOREIGN KEY (organization_id,score_model_id) REFERENCES tenant.crm_lead_scoring_models(organization_id,id) ON DELETE SET NULL (score_model_id) NOT VALID;
ALTER TABLE tenant.crm_leads VALIDATE CONSTRAINT crm_leads_score_model_organization_fkey;
ALTER TABLE tenant.crm_lead_sla_cases DROP CONSTRAINT IF EXISTS crm_lead_sla_cases_lead_id_fkey;
ALTER TABLE tenant.crm_lead_sla_cases DROP CONSTRAINT IF EXISTS crm_lead_sla_cases_policy_id_fkey;
ALTER TABLE tenant.crm_lead_sla_cases ADD CONSTRAINT crm_lead_sla_cases_lead_organization_fkey FOREIGN KEY (organization_id,lead_id) REFERENCES tenant.crm_leads(organization_id,id) ON DELETE CASCADE NOT VALID;
ALTER TABLE tenant.crm_lead_sla_cases ADD CONSTRAINT crm_lead_sla_cases_policy_organization_fkey FOREIGN KEY (organization_id,policy_id) REFERENCES tenant.crm_lead_sla_policies(organization_id,id) ON DELETE RESTRICT NOT VALID;
ALTER TABLE tenant.crm_lead_sla_cases VALIDATE CONSTRAINT crm_lead_sla_cases_lead_organization_fkey;
ALTER TABLE tenant.crm_lead_sla_cases VALIDATE CONSTRAINT crm_lead_sla_cases_policy_organization_fkey;
ALTER TABLE tenant.crm_lead_sla_events DROP CONSTRAINT IF EXISTS crm_lead_sla_events_sla_case_id_fkey;
ALTER TABLE tenant.crm_lead_sla_events DROP CONSTRAINT IF EXISTS crm_lead_sla_events_lead_id_fkey;
ALTER TABLE tenant.crm_lead_sla_events ADD CONSTRAINT crm_lead_sla_events_case_organization_fkey FOREIGN KEY (organization_id,sla_case_id) REFERENCES tenant.crm_lead_sla_cases(organization_id,id) ON DELETE CASCADE NOT VALID;
ALTER TABLE tenant.crm_lead_sla_events ADD CONSTRAINT crm_lead_sla_events_lead_organization_fkey FOREIGN KEY (organization_id,lead_id) REFERENCES tenant.crm_leads(organization_id,id) ON DELETE CASCADE NOT VALID;
ALTER TABLE tenant.crm_lead_sla_events VALIDATE CONSTRAINT crm_lead_sla_events_case_organization_fkey;
ALTER TABLE tenant.crm_lead_sla_events VALIDATE CONSTRAINT crm_lead_sla_events_lead_organization_fkey;
ALTER TABLE tenant.crm_lead_nurture_queue DROP CONSTRAINT IF EXISTS crm_lead_nurture_queue_lead_id_fkey;
ALTER TABLE tenant.crm_lead_nurture_queue DROP CONSTRAINT IF EXISTS crm_lead_nurture_queue_policy_id_fkey;
ALTER TABLE tenant.crm_lead_nurture_queue ADD CONSTRAINT crm_lead_nurture_queue_lead_organization_fkey FOREIGN KEY (organization_id,lead_id) REFERENCES tenant.crm_leads(organization_id,id) ON DELETE CASCADE NOT VALID;
ALTER TABLE tenant.crm_lead_nurture_queue ADD CONSTRAINT crm_lead_nurture_queue_policy_organization_fkey FOREIGN KEY (organization_id,policy_id) REFERENCES tenant.crm_lead_nurture_policies(organization_id,id) ON DELETE RESTRICT NOT VALID;
ALTER TABLE tenant.crm_lead_nurture_queue VALIDATE CONSTRAINT crm_lead_nurture_queue_lead_organization_fkey;
ALTER TABLE tenant.crm_lead_nurture_queue VALIDATE CONSTRAINT crm_lead_nurture_queue_policy_organization_fkey;

CREATE TABLE IF NOT EXISTS tenant.crm_lead_intelligence_acceptance_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  capability_id text NOT NULL CHECK (capability_id IN ('CRM-060','CRM-061','CRM-062')),
  commit_sha text NOT NULL,
  status text NOT NULL CHECK (status IN ('passed','failed','blocked')),
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  evidence_hash text NOT NULL,
  recorded_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,capability_id,commit_sha)
);

WITH model AS (
  INSERT INTO tenant.crm_lead_scoring_models(organization_id,name,version,status,base_score,score_floor,score_ceiling,decay_half_life_days,qualification_thresholds,created_by,updated_by,activated_at)
  SELECT id,'Default behavioural lead model',1,'active',0,-100,100,30,'{"warm":30,"hot":60,"qualified":75}'::jsonb,created_by,created_by,now()
  FROM public.organizations
  ON CONFLICT (organization_id,name,version) DO NOTHING
  RETURNING id,organization_id
)
SELECT 1;

INSERT INTO tenant.crm_lead_scoring_model_rules(organization_id,model_id,name,sequence,signal_type,predicate,points,maximum_occurrences,decay_enabled,created_by,updated_by)
SELECT model.organization_id,model.id,seed.name,seed.sequence,seed.signal_type,seed.predicate,seed.points,seed.maximum_occurrences,seed.decay_enabled,org.created_by,org.created_by
FROM tenant.crm_lead_scoring_models model
JOIN public.organizations org ON org.id=model.organization_id
CROSS JOIN (VALUES
  ('Work email present',10,'demographic','{"field":"email","operator":"not_empty"}'::jsonb,10,NULL,false),
  ('Mobile present',20,'demographic','{"field":"mobile","operator":"not_empty"}'::jsonb,5,NULL,false),
  ('Company identified',30,'firmographic','{"field":"company_name","operator":"not_empty"}'::jsonb,10,NULL,false),
  ('Product interest captured',40,'firmographic','{"field":"product_interest","operator":"not_empty"}'::jsonb,15,NULL,false),
  ('Form submitted',100,'behavioral','{"eventType":"form_submitted","withinDays":90}'::jsonb,10,3,true),
  ('Email clicked',110,'behavioral','{"eventType":"email_clicked","withinDays":60}'::jsonb,6,5,true),
  ('Webinar attended',120,'behavioral','{"eventType":"webinar_attended","withinDays":180}'::jsonb,15,2,true),
  ('Demo requested',130,'behavioral','{"eventType":"demo_requested","withinDays":365}'::jsonb,30,2,false),
  ('Email bounced',200,'negative','{"eventType":"email_bounced","withinDays":180}'::jsonb,-25,2,false),
  ('Unsubscribed',210,'negative','{"eventType":"unsubscribed","withinDays":3650}'::jsonb,-60,1,false)
) AS seed(name,sequence,signal_type,predicate,points,maximum_occurrences,decay_enabled)
WHERE model.status='active'
ON CONFLICT (organization_id,model_id,name) DO NOTHING;

INSERT INTO tenant.crm_lead_sla_policies(organization_id,name,sequence,criteria,first_response_minutes,escalation_after_minutes,business_hours,created_by,updated_by)
SELECT id,'Default lead response SLA',100,'{}'::jsonb,60,30,'{"timezone":"Asia/Kolkata","weekdays":[1,2,3,4,5],"start":"09:00","end":"18:00"}'::jsonb,created_by,created_by
FROM public.organizations
ON CONFLICT (organization_id,name) DO NOTHING;

INSERT INTO tenant.crm_lead_nurture_policies(organization_id,name,sequence,criteria,minimum_score,maximum_score,inactivity_days,action_type,action_template,consent_channel,reentry_days,created_by,updated_by)
SELECT id,'Default seller nurture queue',100,'{}'::jsonb,-100,74,3,'call','{"title":"Contact the lead","description":"Review engagement and complete the next best seller action."}'::jsonb,'any',7,created_by,created_by
FROM public.organizations
ON CONFLICT (organization_id,name) DO NOTHING;


CREATE OR REPLACE FUNCTION tenant.crm_seed_lead_intelligence_defaults()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = tenant, public
AS $$
DECLARE model_id uuid;
BEGIN
  INSERT INTO tenant.crm_lead_scoring_models(organization_id,name,version,status,base_score,score_floor,score_ceiling,decay_half_life_days,qualification_thresholds,created_by,updated_by,activated_at)
  VALUES(NEW.id,'Default behavioural lead model',1,'active',0,-100,100,30,'{"warm":30,"hot":60,"qualified":75}'::jsonb,NEW.created_by,NEW.created_by,now())
  RETURNING id INTO model_id;
  INSERT INTO tenant.crm_lead_scoring_model_rules(organization_id,model_id,name,sequence,signal_type,predicate,points,maximum_occurrences,decay_enabled,created_by,updated_by) VALUES
    (NEW.id,model_id,'Work email present',10,'demographic','{"field":"email","operator":"not_empty"}'::jsonb,10,NULL,false,NEW.created_by,NEW.created_by),
    (NEW.id,model_id,'Company identified',30,'firmographic','{"field":"company_name","operator":"not_empty"}'::jsonb,10,NULL,false,NEW.created_by,NEW.created_by),
    (NEW.id,model_id,'Product interest captured',40,'firmographic','{"field":"product_interest","operator":"not_empty"}'::jsonb,15,NULL,false,NEW.created_by,NEW.created_by),
    (NEW.id,model_id,'Email clicked',110,'behavioral','{"eventType":"email_clicked","withinDays":60}'::jsonb,6,5,true,NEW.created_by,NEW.created_by),
    (NEW.id,model_id,'Demo requested',130,'behavioral','{"eventType":"demo_requested","withinDays":365}'::jsonb,30,2,false,NEW.created_by,NEW.created_by),
    (NEW.id,model_id,'Unsubscribed',210,'negative','{"eventType":"unsubscribed","withinDays":3650}'::jsonb,-60,1,false,NEW.created_by,NEW.created_by);
  INSERT INTO tenant.crm_lead_sla_policies(organization_id,name,sequence,criteria,first_response_minutes,escalation_after_minutes,business_hours,created_by,updated_by)
  VALUES(NEW.id,'Default lead response SLA',100,'{}'::jsonb,60,30,'{"timezone":"Asia/Kolkata","weekdays":[1,2,3,4,5],"start":"09:00","end":"18:00"}'::jsonb,NEW.created_by,NEW.created_by);
  INSERT INTO tenant.crm_lead_nurture_policies(organization_id,name,sequence,criteria,minimum_score,maximum_score,inactivity_days,action_type,action_template,consent_channel,reentry_days,created_by,updated_by)
  VALUES(NEW.id,'Default seller nurture queue',100,'{}'::jsonb,-100,74,3,'call','{"title":"Contact the lead"}'::jsonb,'any',7,NEW.created_by,NEW.created_by);
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS crm_seed_lead_intelligence_defaults ON public.organizations;
CREATE TRIGGER crm_seed_lead_intelligence_defaults AFTER INSERT ON public.organizations
FOR EACH ROW EXECUTE FUNCTION tenant.crm_seed_lead_intelligence_defaults();

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'crm_lead_scoring_models','crm_lead_scoring_model_rules','crm_lead_behavior_events','crm_lead_score_snapshots',
    'crm_lead_sla_policies','crm_lead_sla_cases','crm_lead_sla_events','crm_lead_nurture_policies',
    'crm_lead_nurture_queue','crm_lead_intelligence_acceptance_runs'
  ] LOOP
    EXECUTE format('ALTER TABLE tenant.%I ENABLE ROW LEVEL SECURITY',table_name);
    EXECUTE format('ALTER TABLE tenant.%I FORCE ROW LEVEL SECURITY',table_name);
    EXECUTE format('DROP POLICY IF EXISTS organization_isolation ON tenant.%I',table_name);
    EXECUTE format('CREATE POLICY organization_isolation ON tenant.%I USING (organization_id=tenant.current_organization_id()) WITH CHECK (organization_id=tenant.current_organization_id())',table_name);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION tenant.crm_lead_intelligence_immutable()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'CRM lead intelligence evidence is immutable';
END $$;
DROP TRIGGER IF EXISTS crm_lead_score_snapshots_immutable ON tenant.crm_lead_score_snapshots;
CREATE TRIGGER crm_lead_score_snapshots_immutable BEFORE UPDATE OR DELETE ON tenant.crm_lead_score_snapshots
FOR EACH ROW EXECUTE FUNCTION tenant.crm_lead_intelligence_immutable();
DROP TRIGGER IF EXISTS crm_lead_intelligence_acceptance_immutable ON tenant.crm_lead_intelligence_acceptance_runs;
CREATE TRIGGER crm_lead_intelligence_acceptance_immutable BEFORE UPDATE OR DELETE ON tenant.crm_lead_intelligence_acceptance_runs
FOR EACH ROW EXECUTE FUNCTION tenant.crm_lead_intelligence_immutable();

GRANT SELECT,INSERT,UPDATE,DELETE ON tenant.crm_lead_scoring_models TO vercent_app;
GRANT SELECT,INSERT,UPDATE,DELETE ON tenant.crm_lead_scoring_model_rules TO vercent_app;
GRANT SELECT,INSERT ON tenant.crm_lead_behavior_events TO vercent_app;
GRANT SELECT,INSERT ON tenant.crm_lead_score_snapshots TO vercent_app;
GRANT SELECT,INSERT,UPDATE,DELETE ON tenant.crm_lead_sla_policies TO vercent_app;
GRANT SELECT,INSERT,UPDATE,DELETE ON tenant.crm_lead_sla_cases TO vercent_app;
GRANT SELECT,INSERT ON tenant.crm_lead_sla_events TO vercent_app;
GRANT SELECT,INSERT,UPDATE,DELETE ON tenant.crm_lead_nurture_policies TO vercent_app;
GRANT SELECT,INSERT,UPDATE,DELETE ON tenant.crm_lead_nurture_queue TO vercent_app;
GRANT SELECT,INSERT ON tenant.crm_lead_intelligence_acceptance_runs TO vercent_app;

COMMIT;
