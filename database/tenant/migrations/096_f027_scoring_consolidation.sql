BEGIN;

-- F027 Prompt 4: two parallel scoring systems were found — the sophisticated
-- model/version/decay/cap engine (crm_lead_scoring_models + ...model_rules,
-- "System A") and a legacy static-predicate table (crm_scoring_rules,
-- "System B") that silently overwrote crm_leads.score on every create/update
-- with no version, cap or decay. Application code (lead-intelligence.js,
-- index.js) is changed alongside this migration to make System A the sole
-- writer of crm_leads.score/lead_grade. crm_scoring_rules is left in place
-- (read-only data, no destructive drop) since it is still a reachable
-- generic CRUD resource; it is simply no longer consulted for scoring.
COMMENT ON TABLE tenant.crm_scoring_rules IS 'Retired as of CRM vNext Prompt 4: no longer consulted for Lead scoring. tenant.crm_lead_scoring_models / crm_lead_scoring_model_rules ("System A") is now the sole authority for crm_leads.score/lead_grade. Table kept for historical data only.';

-- Bug fix: the org-creation trigger seeded only 6 of the 10 rules the
-- one-time migration backfill above seeded, so a lead created in a newer
-- org scored differently than one in an org that existed before this
-- migration. Bring the trigger's seed list to full parity.
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
    (NEW.id,model_id,'Mobile present',20,'demographic','{"field":"mobile","operator":"not_empty"}'::jsonb,5,NULL,false,NEW.created_by,NEW.created_by),
    (NEW.id,model_id,'Company identified',30,'firmographic','{"field":"company_name","operator":"not_empty"}'::jsonb,10,NULL,false,NEW.created_by,NEW.created_by),
    (NEW.id,model_id,'Product interest captured',40,'firmographic','{"field":"product_interest","operator":"not_empty"}'::jsonb,15,NULL,false,NEW.created_by,NEW.created_by),
    (NEW.id,model_id,'Form submitted',100,'behavioral','{"eventType":"form_submitted","withinDays":90}'::jsonb,10,3,true,NEW.created_by,NEW.created_by),
    (NEW.id,model_id,'Email clicked',110,'behavioral','{"eventType":"email_clicked","withinDays":60}'::jsonb,6,5,true,NEW.created_by,NEW.created_by),
    (NEW.id,model_id,'Webinar attended',120,'behavioral','{"eventType":"webinar_attended","withinDays":180}'::jsonb,15,2,true,NEW.created_by,NEW.created_by),
    (NEW.id,model_id,'Demo requested',130,'behavioral','{"eventType":"demo_requested","withinDays":365}'::jsonb,30,2,false,NEW.created_by,NEW.created_by),
    (NEW.id,model_id,'Email bounced',200,'negative','{"eventType":"email_bounced","withinDays":180}'::jsonb,-25,2,false,NEW.created_by,NEW.created_by),
    (NEW.id,model_id,'Unsubscribed',210,'negative','{"eventType":"unsubscribed","withinDays":3650}'::jsonb,-60,1,false,NEW.created_by,NEW.created_by);
  INSERT INTO tenant.crm_lead_sla_policies(organization_id,name,sequence,criteria,first_response_minutes,escalation_after_minutes,business_hours,created_by,updated_by)
  VALUES(NEW.id,'Default lead response SLA',100,'{}'::jsonb,60,30,'{"timezone":"Asia/Kolkata","weekdays":[1,2,3,4,5],"start":"09:00","end":"18:00"}'::jsonb,NEW.created_by,NEW.created_by);
  INSERT INTO tenant.crm_lead_nurture_policies(organization_id,name,sequence,criteria,minimum_score,maximum_score,inactivity_days,action_type,action_template,consent_channel,reentry_days,created_by,updated_by)
  VALUES(NEW.id,'Default seller nurture queue',100,'{}'::jsonb,-100,74,3,'call','{"title":"Contact the lead"}'::jsonb,'any',7,NEW.created_by,NEW.created_by);
  RETURN NEW;
END $$;

-- Bulk recalculation job (model activation / configuration change).
-- Mirrors crm_lead_bulk_job_items exactly.
CREATE TABLE IF NOT EXISTS tenant.crm_lead_score_recalc_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  job_id uuid NOT NULL REFERENCES tenant.background_jobs(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES tenant.crm_leads(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','applied','conflict','skipped','failed')),
  previous_score integer,
  new_score integer,
  error_code text,
  error_message text,
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, job_id, lead_id)
);
CREATE INDEX IF NOT EXISTS crm_lead_score_recalc_items_pending_idx
  ON tenant.crm_lead_score_recalc_items(organization_id, job_id, status, lead_id)
  WHERE status='pending';
CREATE INDEX IF NOT EXISTS crm_lead_score_recalc_items_lead_idx
  ON tenant.crm_lead_score_recalc_items(organization_id, lead_id, created_at DESC);

ALTER TABLE tenant.crm_lead_score_recalc_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.crm_lead_score_recalc_items FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_organization_isolation ON tenant.crm_lead_score_recalc_items;
CREATE POLICY tenant_organization_isolation ON tenant.crm_lead_score_recalc_items
  USING (organization_id = current_setting('app.current_organization_id', true)::uuid)
  WITH CHECK (organization_id = current_setting('app.current_organization_id', true)::uuid);

COMMIT;
