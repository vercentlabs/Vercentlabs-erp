BEGIN;

-- F014 Meetings: govern CRM Meeting lifecycle on the canonical crm_activities
-- ledger and bridge existing public meeting bookings into that same work queue.
ALTER TABLE tenant.crm_activities
  ADD COLUMN IF NOT EXISTS meeting_location_type text,
  ADD COLUMN IF NOT EXISTS meeting_url text,
  ADD COLUMN IF NOT EXISTS meeting_outcome_code text,
  ADD COLUMN IF NOT EXISTS meeting_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS meeting_ended_at timestamptz,
  ADD COLUMN IF NOT EXISTS meeting_duration_seconds integer,
  ADD COLUMN IF NOT EXISTS meeting_booking_id uuid,
  ADD COLUMN IF NOT EXISTS meeting_calendar_event_id uuid;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='tenant.crm_activities'::regclass AND conname='crm_activities_meeting_location_type_f014') THEN
    ALTER TABLE tenant.crm_activities ADD CONSTRAINT crm_activities_meeting_location_type_f014
      CHECK (meeting_location_type IS NULL OR (activity_type='meeting' AND meeting_location_type IN ('in_person','online','phone','other')));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='tenant.crm_activities'::regclass AND conname='crm_activities_meeting_outcome_f014') THEN
    ALTER TABLE tenant.crm_activities ADD CONSTRAINT crm_activities_meeting_outcome_f014
      CHECK (meeting_outcome_code IS NULL OR (activity_type='meeting' AND meeting_outcome_code IN ('held','no_show')));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='tenant.crm_activities'::regclass AND conname='crm_activities_meeting_duration_f014') THEN
    ALTER TABLE tenant.crm_activities ADD CONSTRAINT crm_activities_meeting_duration_f014
      CHECK (meeting_duration_seconds IS NULL OR (activity_type='meeting' AND meeting_duration_seconds BETWEEN 0 AND 86400));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='tenant.crm_activities'::regclass AND conname='crm_activities_meeting_time_order_f014') THEN
    ALTER TABLE tenant.crm_activities ADD CONSTRAINT crm_activities_meeting_time_order_f014
      CHECK (meeting_started_at IS NULL OR meeting_ended_at IS NULL OR meeting_started_at <= meeting_ended_at);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='tenant.crm_activities'::regclass AND conname='crm_activities_meeting_fields_only_f014') THEN
    ALTER TABLE tenant.crm_activities ADD CONSTRAINT crm_activities_meeting_fields_only_f014
      CHECK (
        activity_type='meeting'
        OR (
          meeting_location_type IS NULL AND meeting_url IS NULL AND meeting_outcome_code IS NULL
          AND meeting_started_at IS NULL AND meeting_ended_at IS NULL AND meeting_duration_seconds IS NULL
          AND meeting_booking_id IS NULL AND meeting_calendar_event_id IS NULL
        )
      );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='tenant.crm_activities'::regclass AND conname='crm_activities_meeting_booking_f014') THEN
    ALTER TABLE tenant.crm_activities ADD CONSTRAINT crm_activities_meeting_booking_f014
      FOREIGN KEY (organization_id,meeting_booking_id)
      REFERENCES tenant.crm_meeting_bookings(organization_id,id) ON DELETE RESTRICT NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='tenant.crm_activities'::regclass AND conname='crm_activities_meeting_calendar_event_f014') THEN
    ALTER TABLE tenant.crm_activities ADD CONSTRAINT crm_activities_meeting_calendar_event_f014
      FOREIGN KEY (organization_id,meeting_calendar_event_id)
      REFERENCES tenant.crm_calendar_events(organization_id,id) ON DELETE RESTRICT NOT VALID;
  END IF;
END $$;

ALTER TABLE tenant.crm_activities VALIDATE CONSTRAINT crm_activities_meeting_booking_f014;
ALTER TABLE tenant.crm_activities VALIDATE CONSTRAINT crm_activities_meeting_calendar_event_f014;

CREATE INDEX IF NOT EXISTS crm_activities_meetings_f014_idx
  ON tenant.crm_activities(organization_id,company_id,assigned_to,status,start_at)
  WHERE activity_type='meeting';

CREATE UNIQUE INDEX IF NOT EXISTS crm_activities_meeting_booking_f014_uidx
  ON tenant.crm_activities(organization_id,meeting_booking_id)
  WHERE meeting_booking_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS tenant.crm_meeting_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  activity_id uuid NOT NULL,
  event_type text NOT NULL CHECK (event_type IN ('scheduled','logged','booked','updated','rescheduled','started','completed','cancelled')),
  previous_status text,
  next_status text,
  location_type text CHECK (location_type IS NULL OR location_type IN ('in_person','online','phone','other')),
  outcome_code text CHECK (outcome_code IS NULL OR outcome_code IN ('held','no_show')),
  duration_seconds integer CHECK (duration_seconds IS NULL OR duration_seconds BETWEEN 0 AND 86400),
  attendee_count integer NOT NULL DEFAULT 0 CHECK (attendee_count BETWEEN 0 AND 100),
  changed_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  changed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,id),
  FOREIGN KEY (organization_id,activity_id)
    REFERENCES tenant.crm_activities(organization_id,id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS crm_meeting_events_f014_lookup_idx
  ON tenant.crm_meeting_events(organization_id,activity_id,changed_at DESC,id DESC);

CREATE OR REPLACE FUNCTION tenant.crm_meeting_events_immutable_f014()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'CRM Meeting event history is immutable';
END;
$$;

DROP TRIGGER IF EXISTS crm_meeting_events_immutable_f014 ON tenant.crm_meeting_events;
CREATE TRIGGER crm_meeting_events_immutable_f014
BEFORE UPDATE OR DELETE ON tenant.crm_meeting_events
FOR EACH ROW EXECUTE FUNCTION tenant.crm_meeting_events_immutable_f014();

ALTER TABLE tenant.crm_meeting_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.crm_meeting_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_organization_isolation ON tenant.crm_meeting_events;
CREATE POLICY tenant_organization_isolation ON tenant.crm_meeting_events
  USING (organization_id = current_setting('app.current_organization_id', true)::uuid)
  WITH CHECK (organization_id = current_setting('app.current_organization_id', true)::uuid);

COMMENT ON TABLE tenant.crm_meeting_events IS 'Immutable F014 lifecycle ledger for governed CRM Meetings; excludes attendee emails, meeting URLs and free-text notes.';
COMMENT ON COLUMN tenant.crm_activities.meeting_url IS 'F014 scoped meeting join URL. Treat as sensitive content; do not copy to audit/outbox/history payloads.';

COMMIT;
