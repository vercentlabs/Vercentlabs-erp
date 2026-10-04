-- CRM navigation and settings.
--
-- The CRM Settings page gains Task Defaults and Follow-up Defaults: what a
-- new task or follow-up starts with (priority, type, reminder). They are
-- stored on the organization's CRM settings row; a salesperson can still
-- change them on each task or follow-up.

ALTER TABLE tenant.crm_settings
  ADD COLUMN IF NOT EXISTS default_task_priority text NOT NULL DEFAULT 'medium',
  ADD COLUMN IF NOT EXISTS default_task_reminder_minutes integer,
  ADD COLUMN IF NOT EXISTS default_follow_up_type text NOT NULL DEFAULT 'call',
  ADD COLUMN IF NOT EXISTS default_follow_up_reminder_minutes integer;

ALTER TABLE tenant.crm_settings
  ADD CONSTRAINT crm_settings_default_task_priority_check CHECK (default_task_priority IN ('low', 'medium', 'high')),
  ADD CONSTRAINT crm_settings_default_task_reminder_check CHECK (default_task_reminder_minutes IS NULL OR default_task_reminder_minutes BETWEEN 0 AND 43200),
  ADD CONSTRAINT crm_settings_default_follow_up_reminder_check CHECK (default_follow_up_reminder_minutes IS NULL OR default_follow_up_reminder_minutes BETWEEN 0 AND 43200);

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0021_crm_work_defaults.sql', 'crm-work-defaults');
