-- New workspace signup and email-code sign-in (MVP 44). Additive:
--   1. a password becomes optional: people who sign up or join with an email code have none until they set one;
--   2. email_codes: 6-digit codes (only their hash is kept) for signup, sign-in and re-confirming who you are — 10 minutes, 5 wrong tries,
--      a new code cancels the old one;
--   3. signup_requests: a signup in progress (name, work email, company, website) with what was read from the website and the suggested
--      apps; unfinished ones are deleted after 24 hours, and the website text is dropped once the workspace exists;
--   4. organizations.business_profile: what was understood about the business (one line, what it sells, how, the apps suggested, when);
--   5. users.last_module_key: the app someone used last (sign-in returns them there);
--   6. sessions.reauthenticated_at: a person without a password confirmed who they are with an email code (valid 10 minutes);
--      sessions.remember: "stay signed in" — the session lasts its 30 days instead of ending when idle;
--   7. organization_invitations.personal_note: the owner's short note in the invitation email;
--   8. workspace_guides: the Get started card (per person and app) and a teammate's welcome card, and when each was closed.
-- Re-runnable.

ALTER TABLE public.users ALTER COLUMN password_hash DROP NOT NULL;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS last_module_key text;
ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS reauthenticated_at timestamptz;
ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS remember boolean NOT NULL DEFAULT false;
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS business_profile jsonb;
ALTER TABLE public.organization_invitations ADD COLUMN IF NOT EXISTS personal_note text;

CREATE TABLE IF NOT EXISTS public.email_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  purpose text NOT NULL CHECK (purpose IN ('signup', 'sign_in', 'reauth')),
  code_hash text NOT NULL,
  signup_id uuid,
  user_id uuid,
  attempts integer NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS email_codes_email_idx ON public.email_codes (lower(email), purpose, created_at DESC);

CREATE TABLE IF NOT EXISTS public.signup_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash text NOT NULL UNIQUE,
  email text NOT NULL,
  full_name text NOT NULL,
  company_name text NOT NULL,
  website text,
  timezone text,
  status text NOT NULL DEFAULT 'code_sent' CHECK (status IN ('code_sent', 'verified', 'completed')),
  reading_status text NOT NULL DEFAULT 'none' CHECK (reading_status IN ('none', 'reading', 'done', 'failed', 'unclear')),
  website_text text,
  description_input text,
  profile jsonb,
  suggestion_runs integer NOT NULL DEFAULT 0,
  existing_user_id uuid,
  organization_id uuid,
  ip_address text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  verified_at timestamptz,
  completed_at timestamptz,
  expires_at timestamptz NOT NULL DEFAULT (clock_timestamp() + interval '24 hours')
);
CREATE INDEX IF NOT EXISTS signup_requests_expiry_idx ON public.signup_requests (expires_at) WHERE status <> 'completed';

GRANT SELECT, INSERT, UPDATE, DELETE ON public.email_codes TO vercent_app, vercent_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.signup_requests TO vercent_app, vercent_worker;

CREATE TABLE IF NOT EXISTS public.workspace_guides (
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  guide text NOT NULL CHECK (guide IN ('get_started', 'welcome')),
  module_key text NOT NULL DEFAULT '',
  dismissed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (organization_id, user_id, guide, module_key)
);
ALTER TABLE public.workspace_guides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_guides FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'workspace_guides' AND policyname = 'organization_isolation') THEN
    CREATE POLICY organization_isolation ON public.workspace_guides USING (organization_id = public.current_organization_id()) WITH CHECK (organization_id = public.current_organization_id());
  END IF;
END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.workspace_guides TO vercent_app, vercent_worker;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0215_code_sign_in_signup.sql', 'code-sign-in-signup') ON CONFLICT DO NOTHING;
