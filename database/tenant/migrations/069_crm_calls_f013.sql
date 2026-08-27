BEGIN;

-- F013 Calls: specialize the existing CRM activity row rather than creating a
-- second activity ledger. Existing pre-F013 call rows remain readable with
-- nullable call metadata; every new governed F013 write supplies it.
ALTER TABLE tenant.crm_activities
  ADD COLUMN IF NOT EXISTS call_direction text,
  ADD COLUMN IF NOT EXISTS call_phone text,
  ADD COLUMN IF NOT EXISTS call_outcome_code text,
  ADD COLUMN IF NOT EXISTS call_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS call_ended_at timestamptz,
  ADD COLUMN IF NOT EXISTS call_duration_seconds integer;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='tenant.crm_activities'::regclass AND conname='crm_activities_call_direction_f013') THEN
    ALTER TABLE tenant.crm_activities ADD CONSTRAINT crm_activities_call_direction_f013
      CHECK (call_direction IS NULL OR (activity_type='call' AND call_direction IN ('inbound','outbound')));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='tenant.crm_activities'::regclass AND conname='crm_activities_call_outcome_f013') THEN
    ALTER TABLE tenant.crm_activities ADD CONSTRAINT crm_activities_call_outcome_f013
      CHECK (call_outcome_code IS NULL OR (activity_type='call' AND call_outcome_code IN ('connected','no_answer','busy','voicemail','callback_requested','wrong_number','failed')));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='tenant.crm_activities'::regclass AND conname='crm_activities_call_duration_f013') THEN
    ALTER TABLE tenant.crm_activities ADD CONSTRAINT crm_activities_call_duration_f013
      CHECK (call_duration_seconds IS NULL OR (activity_type='call' AND call_duration_seconds BETWEEN 0 AND 86400));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='tenant.crm_activities'::regclass AND conname='crm_activities_call_time_order_f013') THEN
    ALTER TABLE tenant.crm_activities ADD CONSTRAINT crm_activities_call_time_order_f013
      CHECK (call_started_at IS NULL OR call_ended_at IS NULL OR call_started_at <= call_ended_at);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='tenant.crm_activities'::regclass AND conname='crm_activities_call_fields_only_f013') THEN
    ALTER TABLE tenant.crm_activities ADD CONSTRAINT crm_activities_call_fields_only_f013
      CHECK (activity_type='call' OR (call_direction IS NULL AND call_phone IS NULL AND call_outcome_code IS NULL AND call_started_at IS NULL AND call_ended_at IS NULL AND call_duration_seconds IS NULL));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS crm_activities_calls_f013_idx
  ON tenant.crm_activities(organization_id,company_id,assigned_to,status,due_at)
  WHERE activity_type='call';

CREATE TABLE IF NOT EXISTS tenant.crm_call_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  activity_id uuid NOT NULL,
  event_type text NOT NULL CHECK (event_type IN ('scheduled','logged','updated','started','completed','cancelled')),
  previous_status text,
  next_status text,
  direction text CHECK (direction IS NULL OR direction IN ('inbound','outbound')),
  outcome_code text CHECK (outcome_code IS NULL OR outcome_code IN ('connected','no_answer','busy','voicemail','callback_requested','wrong_number','failed')),
  duration_seconds integer CHECK (duration_seconds IS NULL OR duration_seconds BETWEEN 0 AND 86400),
  changed_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  changed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,id),
  FOREIGN KEY (organization_id,activity_id)
    REFERENCES tenant.crm_activities(organization_id,id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS crm_call_events_f013_lookup_idx
  ON tenant.crm_call_events(organization_id,activity_id,changed_at DESC,id DESC);

CREATE OR REPLACE FUNCTION tenant.crm_call_events_immutable_f013()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'CRM Call event history is immutable';
END;
$$;
DROP TRIGGER IF EXISTS crm_call_events_immutable_f013 ON tenant.crm_call_events;
CREATE TRIGGER crm_call_events_immutable_f013
BEFORE UPDATE OR DELETE ON tenant.crm_call_events
FOR EACH ROW EXECUTE FUNCTION tenant.crm_call_events_immutable_f013();

ALTER TABLE tenant.crm_call_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.crm_call_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_organization_isolation ON tenant.crm_call_events;
CREATE POLICY tenant_organization_isolation ON tenant.crm_call_events
  USING (organization_id = current_setting('app.current_organization_id', true)::uuid)
  WITH CHECK (organization_id = current_setting('app.current_organization_id', true)::uuid);

COMMENT ON TABLE tenant.crm_call_events IS 'Immutable F013 lifecycle ledger for governed manual CRM Calls; excludes phone numbers and free-text notes.';
COMMENT ON COLUMN tenant.crm_activities.call_phone IS 'F013 dialled/received phone snapshot. PII: do not copy to audit/outbox payloads.';

COMMIT;
