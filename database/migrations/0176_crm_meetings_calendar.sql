-- CRM plan, step 4.5: meeting invitations, and Google / Outlook calendar sync.
--
-- 1. A planned meeting (a meeting activity, or a follow-up by meeting) can be sent to its attendees as a calendar invitation (iCalendar,
--    with the organizer's name and the record it is about). Moving or cancelling the meeting sends the update to the same people, as one
--    invitation (its UID) with a rising sequence.
-- 2. Each salesperson may connect their Google or Microsoft (Outlook / Office 365) calendar. Their CRM meetings and follow-up meetings are
--    then kept in it: added, moved and removed by a background sync; the event remembers which CRM activity it is.
CREATE TABLE IF NOT EXISTS tenant.crm_meeting_invitations (
  organization_id uuid NOT NULL,
  activity_id uuid NOT NULL,
  uid text NOT NULL,
  sequence integer NOT NULL DEFAULT 0,
  attendees jsonb NOT NULL DEFAULT '[]'::jsonb,
  location text,
  duration_minutes integer NOT NULL DEFAULT 30 CHECK (duration_minutes BETWEEN 5 AND 1440),
  organizer_user_id uuid REFERENCES public.users(id),
  status text NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'cancelled')),
  sent_for timestamptz,
  sent_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, activity_id)
);

CREATE TABLE IF NOT EXISTS tenant.crm_calendar_connections (
  organization_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES public.users(id),
  provider text NOT NULL CHECK (provider IN ('google', 'microsoft')),
  account_email text,
  calendar_id text NOT NULL DEFAULT 'primary',
  encrypted_tokens jsonb NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'error', 'disconnected')),
  last_sync_at timestamptz,
  last_error text,
  connected_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, user_id, provider)
);

CREATE TABLE IF NOT EXISTS tenant.crm_calendar_events (
  organization_id uuid NOT NULL,
  activity_id uuid NOT NULL,
  user_id uuid NOT NULL,
  provider text NOT NULL,
  external_id text NOT NULL,
  synced_version text,
  synced_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, activity_id, user_id, provider)
);

DO $$
DECLARE
  name text;
BEGIN
  FOREACH name IN ARRAY ARRAY['crm_meeting_invitations', 'crm_calendar_connections', 'crm_calendar_events'] LOOP
    EXECUTE format('ALTER TABLE tenant.%I ENABLE ROW LEVEL SECURITY', name);
    EXECUTE format('ALTER TABLE tenant.%I FORCE ROW LEVEL SECURITY', name);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'tenant' AND tablename = name AND policyname = 'organization_isolation') THEN
      EXECUTE format('CREATE POLICY organization_isolation ON tenant.%I USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id())', name);
    END IF;
  END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE ON tenant.crm_meeting_invitations TO vercent_app, vercent_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON tenant.crm_calendar_connections, tenant.crm_calendar_events TO vercent_app, vercent_worker;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0176_crm_meetings_calendar.sql', 'crm-meetings-calendar') ON CONFLICT DO NOTHING;
