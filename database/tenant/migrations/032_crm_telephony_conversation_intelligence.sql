BEGIN;

ALTER TABLE tenant.crm_conversations
  ADD COLUMN IF NOT EXISTS direction text,
  ADD COLUMN IF NOT EXISTS owner_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS from_number text,
  ADD COLUMN IF NOT EXISTS to_number text,
  ADD COLUMN IF NOT EXISTS disposition text,
  ADD COLUMN IF NOT EXISTS duration_seconds integer,
  ADD COLUMN IF NOT EXISTS provider_call_id text,
  ADD COLUMN IF NOT EXISTS recording_status text NOT NULL DEFAULT 'not_available';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname='crm_conversations_direction_check'
  ) THEN
    ALTER TABLE tenant.crm_conversations ADD CONSTRAINT crm_conversations_direction_check
      CHECK (direction IS NULL OR direction IN ('inbound','outbound'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname='crm_conversations_duration_check'
  ) THEN
    ALTER TABLE tenant.crm_conversations ADD CONSTRAINT crm_conversations_duration_check
      CHECK (duration_seconds IS NULL OR duration_seconds >= 0);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname='crm_conversations_recording_status_check'
  ) THEN
    ALTER TABLE tenant.crm_conversations ADD CONSTRAINT crm_conversations_recording_status_check
      CHECK (recording_status IN ('not_available','pending','available','failed','redacted','expired'));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS crm_conversations_provider_call_uidx
  ON tenant.crm_conversations(organization_id, provider, provider_call_id)
  WHERE provider_call_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS tenant.crm_telephony_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  company_id uuid,
  provider text NOT NULL CHECK (provider IN ('twilio','exotel','plivo','mock','custom')),
  display_name text NOT NULL,
  credential_reference text NOT NULL,
  webhook_key text NOT NULL,
  default_from_number text,
  recording_enabled boolean NOT NULL DEFAULT false,
  transcription_enabled boolean NOT NULL DEFAULT false,
  require_recording_consent boolean NOT NULL DEFAULT true,
  retention_days integer NOT NULL DEFAULT 90 CHECK (retention_days BETWEEN 1 AND 3650),
  status text NOT NULL DEFAULT 'disconnected' CHECK (status IN ('disconnected','connected','error','disabled')),
  last_webhook_at timestamptz,
  last_error text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, provider, display_name),
  UNIQUE (webhook_key),
  FOREIGN KEY (organization_id, company_id) REFERENCES public.companies(organization_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tenant.crm_telephony_commands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  connection_id uuid NOT NULL,
  conversation_id uuid NOT NULL,
  command_type text NOT NULL CHECK (command_type IN ('start_call','end_call','fetch_recording','delete_recording')),
  idempotency_key text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','processing','completed','failed','dead_letter')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  provider_reference text,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, idempotency_key),
  FOREIGN KEY (organization_id, connection_id) REFERENCES tenant.crm_telephony_connections(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, conversation_id) REFERENCES tenant.crm_conversations(organization_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS crm_telephony_commands_queue_idx
  ON tenant.crm_telephony_commands(organization_id,status,next_attempt_at)
  WHERE status IN ('queued','failed');

CREATE TABLE IF NOT EXISTS tenant.crm_telephony_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  connection_id uuid NOT NULL,
  conversation_id uuid,
  provider text NOT NULL,
  provider_event_id text NOT NULL,
  event_type text NOT NULL,
  occurred_at timestamptz NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  payload_hash text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, provider, provider_event_id),
  FOREIGN KEY (organization_id, connection_id) REFERENCES tenant.crm_telephony_connections(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, conversation_id) REFERENCES tenant.crm_conversations(organization_id, id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS tenant.crm_conversation_recordings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL,
  provider text NOT NULL,
  provider_recording_id text,
  storage_reference text NOT NULL,
  media_type text NOT NULL DEFAULT 'audio/mpeg',
  duration_seconds integer CHECK (duration_seconds IS NULL OR duration_seconds >= 0),
  byte_size bigint CHECK (byte_size IS NULL OR byte_size >= 0),
  checksum_sha256 text,
  consent_status text NOT NULL CHECK (consent_status IN ('granted','not_required','denied','unknown')),
  retention_until timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'available' CHECK (status IN ('pending','available','failed','redacted','expired','deleted')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, provider, provider_recording_id),
  FOREIGN KEY (organization_id, conversation_id) REFERENCES tenant.crm_conversations(organization_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tenant.crm_recording_access_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  recording_id uuid NOT NULL,
  token_hash text NOT NULL,
  purpose text NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  issued_to uuid REFERENCES public.users(id) ON DELETE SET NULL,
  issued_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (token_hash),
  FOREIGN KEY (organization_id, recording_id) REFERENCES tenant.crm_conversation_recordings(organization_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tenant.crm_transcription_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL,
  recording_id uuid NOT NULL,
  provider text NOT NULL CHECK (provider IN ('openai','azure','google','aws','deepgram','mock','custom')),
  credential_reference text,
  language_code text NOT NULL DEFAULT 'en-IN',
  diarization_enabled boolean NOT NULL DEFAULT true,
  redaction_enabled boolean NOT NULL DEFAULT true,
  idempotency_key text NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','processing','completed','failed','dead_letter','cancelled')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  provider_job_id text,
  last_error text,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, idempotency_key),
  FOREIGN KEY (organization_id, conversation_id) REFERENCES tenant.crm_conversations(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, recording_id) REFERENCES tenant.crm_conversation_recordings(organization_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS crm_transcription_jobs_queue_idx
  ON tenant.crm_transcription_jobs(organization_id,status,next_attempt_at)
  WHERE status IN ('queued','failed');

CREATE TABLE IF NOT EXISTS tenant.crm_conversation_transcripts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL,
  recording_id uuid NOT NULL,
  job_id uuid NOT NULL,
  language_code text NOT NULL,
  transcript_text text NOT NULL,
  redacted_text text,
  confidence numeric(6,5) CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 1),
  provider text NOT NULL,
  provider_model text,
  content_hash text NOT NULL,
  status text NOT NULL DEFAULT 'ready' CHECK (status IN ('ready','reviewed','redacted','superseded')),
  reviewed_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  redacted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, job_id),
  FOREIGN KEY (organization_id, conversation_id) REFERENCES tenant.crm_conversations(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, recording_id) REFERENCES tenant.crm_conversation_recordings(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, job_id) REFERENCES tenant.crm_transcription_jobs(organization_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tenant.crm_transcript_segments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  transcript_id uuid NOT NULL,
  sequence integer NOT NULL CHECK (sequence > 0),
  speaker_label text NOT NULL,
  started_ms integer NOT NULL CHECK (started_ms >= 0),
  ended_ms integer NOT NULL CHECK (ended_ms >= started_ms),
  text text NOT NULL,
  confidence numeric(6,5) CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, transcript_id, sequence),
  FOREIGN KEY (organization_id, transcript_id) REFERENCES tenant.crm_conversation_transcripts(organization_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tenant.crm_conversation_action_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL,
  transcript_id uuid,
  title text NOT NULL,
  description text,
  owner_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  due_at timestamptz,
  source text NOT NULL DEFAULT 'transcript' CHECK (source IN ('manual','transcript','provider','ai')),
  evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','completed','dismissed')),
  completed_at timestamptz,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, conversation_id) REFERENCES tenant.crm_conversations(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, transcript_id) REFERENCES tenant.crm_conversation_transcripts(organization_id, id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS tenant.crm_conversation_acceptance_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  capability_id text NOT NULL CHECK (capability_id IN ('CRM-003','CRM-006','CRM-046','CRM-049')),
  status text NOT NULL CHECK (status IN ('passed','failed','blocked')),
  commit_sha text NOT NULL,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  evidence_hash text NOT NULL,
  provider_acceptance text NOT NULL DEFAULT 'sandbox' CHECK (provider_acceptance IN ('sandbox','production','not_required')),
  recorded_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, capability_id, commit_sha)
);

CREATE OR REPLACE FUNCTION tenant.crm_public_telephony_connection(key text)
RETURNS TABLE (organization_id uuid, connection_id uuid, provider text, created_by uuid)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = tenant, public
AS $$
  SELECT connection.organization_id,connection.id,connection.provider,connection.created_by
  FROM tenant.crm_telephony_connections connection
  WHERE connection.webhook_key=key AND connection.status='connected'
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION tenant.crm_conversation_evidence_immutable()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'crm_telephony_events' AND TG_OP = 'UPDATE'
     AND OLD.conversation_id IS NULL AND NEW.conversation_id IS NOT NULL
     AND OLD.organization_id = NEW.organization_id
     AND OLD.provider_event_id = NEW.provider_event_id
     AND OLD.payload_hash = NEW.payload_hash THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'CRM conversation evidence is immutable';
END;
$$;

DROP TRIGGER IF EXISTS crm_telephony_events_immutable ON tenant.crm_telephony_events;
CREATE TRIGGER crm_telephony_events_immutable
BEFORE UPDATE OR DELETE ON tenant.crm_telephony_events
FOR EACH ROW EXECUTE FUNCTION tenant.crm_conversation_evidence_immutable();

DROP TRIGGER IF EXISTS crm_conversation_acceptance_immutable ON tenant.crm_conversation_acceptance_runs;
CREATE TRIGGER crm_conversation_acceptance_immutable
BEFORE UPDATE OR DELETE ON tenant.crm_conversation_acceptance_runs
FOR EACH ROW EXECUTE FUNCTION tenant.crm_conversation_evidence_immutable();

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'crm_telephony_connections','crm_telephony_commands','crm_telephony_events',
    'crm_conversation_recordings','crm_recording_access_grants','crm_transcription_jobs',
    'crm_conversation_transcripts','crm_transcript_segments','crm_conversation_action_items',
    'crm_conversation_acceptance_runs'
  ] LOOP
    EXECUTE format('ALTER TABLE tenant.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE tenant.%I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('DROP POLICY IF EXISTS organization_isolation ON tenant.%I', table_name);
    EXECUTE format(
      'CREATE POLICY organization_isolation ON tenant.%I USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id())',
      table_name
    );
  END LOOP;
END $$;

GRANT SELECT,INSERT,UPDATE,DELETE ON tenant.crm_telephony_connections TO vercent_app;
GRANT SELECT,INSERT,UPDATE,DELETE ON tenant.crm_telephony_commands TO vercent_app;
GRANT SELECT,INSERT ON tenant.crm_telephony_events TO vercent_app;
GRANT SELECT,INSERT,UPDATE,DELETE ON tenant.crm_conversation_recordings TO vercent_app;
GRANT SELECT,INSERT,UPDATE,DELETE ON tenant.crm_recording_access_grants TO vercent_app;
GRANT SELECT,INSERT,UPDATE,DELETE ON tenant.crm_transcription_jobs TO vercent_app;
GRANT SELECT,INSERT,UPDATE ON tenant.crm_conversation_transcripts TO vercent_app;
GRANT SELECT,INSERT,UPDATE,DELETE ON tenant.crm_transcript_segments TO vercent_app;
GRANT SELECT,INSERT,UPDATE,DELETE ON tenant.crm_conversation_action_items TO vercent_app;
GRANT SELECT,INSERT ON tenant.crm_conversation_acceptance_runs TO vercent_app;

COMMIT;
