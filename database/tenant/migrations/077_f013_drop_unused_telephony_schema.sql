BEGIN;

-- F013 Calls: migration 032 built a complete telephony/recording/
-- transcription schema (10 tables, 2 functions, 2 triggers) that no
-- application code ever used — confirmed by a repo-wide search finding zero
-- references to any of these tables/functions outside this migration file
-- itself. Per owner decision (2026-09-05): Calls stays manual-logging only;
-- this dormant schema is removed rather than left as a confusing, untested
-- surface someone could accidentally build on top of later. The base
-- `crm_conversations` table predates this migration (005) and is in active
-- use for generic conversation threads — only the telephony-specific
-- columns/constraint/index that 032 added to it are reverted here.

DROP TRIGGER IF EXISTS crm_conversation_acceptance_immutable ON tenant.crm_conversation_acceptance_runs;
DROP TRIGGER IF EXISTS crm_telephony_events_immutable ON tenant.crm_telephony_events;
DROP FUNCTION IF EXISTS tenant.crm_conversation_evidence_immutable();
DROP FUNCTION IF EXISTS tenant.crm_public_telephony_connection(text);

DROP TABLE IF EXISTS tenant.crm_conversation_acceptance_runs;
DROP TABLE IF EXISTS tenant.crm_conversation_action_items;
DROP TABLE IF EXISTS tenant.crm_transcript_segments;
DROP TABLE IF EXISTS tenant.crm_conversation_transcripts;
DROP TABLE IF EXISTS tenant.crm_transcription_jobs;
DROP TABLE IF EXISTS tenant.crm_recording_access_grants;
DROP TABLE IF EXISTS tenant.crm_conversation_recordings;
DROP TABLE IF EXISTS tenant.crm_telephony_events;
DROP TABLE IF EXISTS tenant.crm_telephony_commands;
DROP TABLE IF EXISTS tenant.crm_telephony_connections;

DROP INDEX IF EXISTS tenant.crm_conversations_provider_call_uidx;

ALTER TABLE tenant.crm_conversations
  DROP CONSTRAINT IF EXISTS crm_conversations_direction_check,
  DROP CONSTRAINT IF EXISTS crm_conversations_duration_check,
  DROP CONSTRAINT IF EXISTS crm_conversations_recording_status_check,
  DROP COLUMN IF EXISTS direction,
  DROP COLUMN IF EXISTS owner_user_id,
  DROP COLUMN IF EXISTS from_number,
  DROP COLUMN IF EXISTS to_number,
  DROP COLUMN IF EXISTS disposition,
  DROP COLUMN IF EXISTS duration_seconds,
  DROP COLUMN IF EXISTS provider_call_id,
  DROP COLUMN IF EXISTS recording_status;

COMMIT;
