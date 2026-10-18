-- CRM plan, step 5.2: activity types, chaining and plans; repeating follow-ups; one type list.
--
-- Activity types: the organization's own list of follow-up types ("Site visit", "Payment reminder call"…). Each has a base kind — call,
-- email, meeting, demo, visit, WhatsApp or other — that decides what completing it records and which consent applies, plus its defaults:
-- how long after it is planned it falls due, who does it, the reminder, an email template, and what comes next (suggested, or planned
-- automatically, some days later). The seven standard types are created for each organization the first time they are needed.
--
-- Activity plans: a named sequence of follow-ups ("New enquiry: call today, email in 2 days, visit in a week") applied to a lead or deal
-- in one click.
--
-- Repeating follow-ups: every N days, weeks or months, until a date; completing one plans the next.
CREATE TABLE IF NOT EXISTS tenant.crm_activity_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  code text NOT NULL CHECK (code ~ '^[a-z0-9_]{1,40}$'),
  name text NOT NULL CHECK (btrim(name) <> '' AND char_length(name) <= 80),
  kind text NOT NULL CHECK (kind IN ('call', 'email', 'meeting', 'demo', 'visit', 'whatsapp', 'other')),
  icon text CHECK (icon IS NULL OR char_length(icon) <= 40),
  default_delay_hours integer CHECK (default_delay_hours IS NULL OR default_delay_hours BETWEEN 0 AND 2160),
  default_assignee text NOT NULL DEFAULT 'record_owner' CHECK (default_assignee IN ('record_owner', 'creator', 'user')),
  default_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  default_reminder_minutes integer CHECK (default_reminder_minutes IS NULL OR default_reminder_minutes BETWEEN 0 AND 43200),
  email_template_id uuid REFERENCES tenant.crm_email_templates(id) ON DELETE SET NULL,
  chaining text NOT NULL DEFAULT 'none' CHECK (chaining IN ('none', 'suggest', 'trigger')),
  next_type_id uuid REFERENCES tenant.crm_activity_types(id) ON DELETE SET NULL,
  next_delay_days integer NOT NULL DEFAULT 1 CHECK (next_delay_days BETWEEN 0 AND 365),
  sequence integer NOT NULL DEFAULT 100,
  is_standard boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, code),
  CHECK (chaining = 'none' OR next_type_id IS NOT NULL),
  CHECK (default_assignee <> 'user' OR default_user_id IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS tenant.crm_activity_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (btrim(name) <> '' AND char_length(name) <= 120),
  description text CHECK (description IS NULL OR char_length(description) <= 500),
  applies_to text NOT NULL DEFAULT 'any' CHECK (applies_to IN ('lead', 'opportunity', 'any')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS tenant.crm_activity_plan_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  plan_id uuid NOT NULL REFERENCES tenant.crm_activity_plans(id) ON DELETE CASCADE,
  sequence integer NOT NULL,
  activity_type_id uuid NOT NULL REFERENCES tenant.crm_activity_types(id),
  subject text CHECK (subject IS NULL OR char_length(subject) <= 200),
  offset_days integer NOT NULL DEFAULT 0 CHECK (offset_days BETWEEN 0 AND 365),
  assignee text NOT NULL DEFAULT 'record_owner' CHECK (assignee IN ('record_owner', 'applier', 'user')),
  user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  UNIQUE (plan_id, sequence),
  CHECK (assignee <> 'user' OR user_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS crm_activity_plan_steps_plan_idx ON tenant.crm_activity_plan_steps (organization_id, plan_id, sequence);

ALTER TABLE tenant.crm_activities ADD COLUMN IF NOT EXISTS activity_type_id uuid REFERENCES tenant.crm_activity_types(id) ON DELETE SET NULL;
ALTER TABLE tenant.crm_activities ADD COLUMN IF NOT EXISTS repeat_every integer;
ALTER TABLE tenant.crm_activities ADD COLUMN IF NOT EXISTS repeat_unit text;
ALTER TABLE tenant.crm_activities ADD COLUMN IF NOT EXISTS repeat_until date;
ALTER TABLE tenant.crm_activities ADD COLUMN IF NOT EXISTS repeat_series_id uuid;
ALTER TABLE tenant.crm_activities ADD COLUMN IF NOT EXISTS activity_plan_id uuid REFERENCES tenant.crm_activity_plans(id) ON DELETE SET NULL;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'crm_activities_repeat_check') THEN
    ALTER TABLE tenant.crm_activities ADD CONSTRAINT crm_activities_repeat_check CHECK (
      (repeat_every IS NULL AND repeat_unit IS NULL) OR (repeat_every BETWEEN 1 AND 365 AND repeat_unit IN ('day', 'week', 'month')));
  END IF;
END $$;

DO $$
DECLARE
  name text;
BEGIN
  FOREACH name IN ARRAY ARRAY['crm_activity_types', 'crm_activity_plans', 'crm_activity_plan_steps'] LOOP
    EXECUTE format('ALTER TABLE tenant.%I ENABLE ROW LEVEL SECURITY', name);
    EXECUTE format('ALTER TABLE tenant.%I FORCE ROW LEVEL SECURITY', name);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'tenant' AND tablename = name AND policyname = 'organization_isolation') THEN
      EXECUTE format('CREATE POLICY organization_isolation ON tenant.%I USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id())', name);
    END IF;
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON tenant.%I TO vercent_app, vercent_worker', name);
  END LOOP;
END $$;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0179_crm_activity_types_plans.sql', 'crm-activity-types-plans') ON CONFLICT DO NOTHING;
