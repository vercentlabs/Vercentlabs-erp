-- Shared Platform plan, step 6: approval rules and Sign in with Google / Microsoft.
--
-- 1. Approval rules: which documents need approval, from what amount, by whom (a named user or anyone with a role), in up to two
--    levels. A request raised under a rule remembers its level and the role it is for.
CREATE TABLE IF NOT EXISTS public.approval_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  document_type text NOT NULL CHECK (document_type ~ '^[a-z_]+\.[a-z_]+$'),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  min_amount numeric(20,2) NOT NULL DEFAULT 0 CHECK (min_amount >= 0),
  level smallint NOT NULL DEFAULT 1 CHECK (level IN (1, 2)),
  approver_user_id uuid REFERENCES public.users(id) ON DELETE CASCADE,
  approver_role_id uuid REFERENCES public.roles(id) ON DELETE CASCADE,
  active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT approval_rules_one_approver CHECK ((approver_user_id IS NULL) <> (approver_role_id IS NULL))
);
CREATE INDEX IF NOT EXISTS approval_rules_lookup_idx ON public.approval_rules (organization_id, document_type, level, min_amount DESC) WHERE active;
ALTER TABLE public.approval_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.approval_rules FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS organization_isolation ON public.approval_rules;
CREATE POLICY organization_isolation ON public.approval_rules USING (organization_id = public.current_organization_id()) WITH CHECK (organization_id = public.current_organization_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON public.approval_rules TO vercent_app;

ALTER TABLE public.approval_requests ADD COLUMN IF NOT EXISTS approval_level smallint;
ALTER TABLE public.approval_requests ADD COLUMN IF NOT EXISTS approver_role_id uuid REFERENCES public.roles(id) ON DELETE SET NULL;
ALTER TABLE public.approval_requests ADD COLUMN IF NOT EXISTS approval_rule_id uuid REFERENCES public.approval_rules(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS approval_requests_role_pending_idx ON public.approval_requests (organization_id, approver_role_id) WHERE status = 'pending' AND approver_role_id IS NOT NULL;

-- 2. Sign in with Google / Microsoft: a person links their Google or Microsoft account (or, for Google, a verified address that is
--    already theirs is linked on first use) and can then sign in with it. MFA still applies. The round trip's one-time state.
CREATE TABLE IF NOT EXISTS public.user_external_identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('google', 'microsoft')),
  subject text NOT NULL CHECK (length(subject) BETWEEN 1 AND 200),
  email text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  UNIQUE (provider, subject)
);
CREATE INDEX IF NOT EXISTS user_external_identities_user_idx ON public.user_external_identities (user_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_external_identities TO vercent_app;

CREATE TABLE IF NOT EXISTS public.auth_sign_in_states (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  state_hash text NOT NULL UNIQUE,
  provider text NOT NULL CHECK (provider IN ('google', 'microsoft')),
  purpose text NOT NULL CHECK (purpose IN ('sign_in', 'link')),
  user_id uuid REFERENCES public.users(id) ON DELETE CASCADE,
  encrypted_verifier jsonb NOT NULL,
  nonce_hash text NOT NULL,
  return_to text,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (purpose = 'sign_in' OR user_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS auth_sign_in_states_expiry_idx ON public.auth_sign_in_states (expires_at);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.auth_sign_in_states TO vercent_app;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0190_platform_approval_rules_sign_in.sql', 'platform-approval-rules-sign-in') ON CONFLICT DO NOTHING;
