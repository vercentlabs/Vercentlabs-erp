-- CRM audit (Vercentlabs CRM — Full Audit Report, 21 Oct 2026). Additive and re-runnable.
--
-- 1. Working week per organization (M3, B4): the days and hours the business works, and which Saturdays of the month are off
--    (many Indian businesses close on the 2nd and 4th). Reminders skip days off (with the holidays), and the lead first-response
--    time and the stage time limits count working hours and days. New and existing organizations start Monday–Saturday, 10:00–19:00.

ALTER TABLE tenant.crm_settings
  ADD COLUMN IF NOT EXISTS working_days smallint[] NOT NULL DEFAULT '{1,2,3,4,5,6}',
  ADD COLUMN IF NOT EXISTS work_start text NOT NULL DEFAULT '10:00',
  ADD COLUMN IF NOT EXISTS work_end text NOT NULL DEFAULT '19:00',
  ADD COLUMN IF NOT EXISTS saturdays_off smallint[] NOT NULL DEFAULT '{}';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'crm_settings_working_week_check') THEN
    ALTER TABLE tenant.crm_settings ADD CONSTRAINT crm_settings_working_week_check CHECK (
      cardinality(working_days) BETWEEN 1 AND 7 AND working_days <@ '{0,1,2,3,4,5,6}'::smallint[]
      AND work_start ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' AND work_end ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' AND work_start < work_end
      AND saturdays_off <@ '{1,2,3,4,5}'::smallint[]);
  END IF;
END $$;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0217_crm_audit.sql', 'crm-audit') ON CONFLICT DO NOTHING;
