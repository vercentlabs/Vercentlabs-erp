BEGIN;

-- T01 Shared Platform + Experience Kernel completion.
-- These tables live in the platform/control-plane schema because they govern
-- tenant access, integrations, configuration and shared runtime policy rather
-- than module-private business truth. Every mutable row is organization-scoped.

CREATE TABLE IF NOT EXISTS billing_usage_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  month_start date NOT NULL,
  metric text NOT NULL,
  quantity bigint NOT NULL CHECK (quantity > 0),
  idempotency_key text NOT NULL,
  source text NOT NULL DEFAULT 'runtime',
  recorded_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, metric, idempotency_key)
);
CREATE INDEX IF NOT EXISTS billing_usage_events_org_month_idx
  ON billing_usage_events(organization_id, month_start, metric, recorded_at DESC);

CREATE TABLE IF NOT EXISTS workflow_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  workflow_id uuid NOT NULL REFERENCES workflow_definitions(id) ON DELETE CASCADE,
  trigger_key text NOT NULL,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  idempotency_key text NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','running','succeeded','failed','cancelled')),
  input_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  output_payload jsonb,
  error_code text,
  error_message text,
  started_at timestamptz,
  finished_at timestamptz,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS workflow_runs_org_status_idx
  ON workflow_runs(organization_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS notification_preferences (
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel text NOT NULL CHECK (channel IN ('in_app','email','push')),
  category text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  quiet_hours_start time,
  quiet_hours_end time,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, user_id, channel, category)
);

CREATE TABLE IF NOT EXISTS inbound_mail_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  provider text NOT NULL,
  provider_message_id text NOT NULL,
  route_key text NOT NULL,
  sender_hash char(64),
  subject text,
  status text NOT NULL DEFAULT 'received'
    CHECK (status IN ('received','processed','ignored','failed')),
  payload_digest char(64) NOT NULL,
  processing_error text,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  UNIQUE (organization_id, provider, provider_message_id)
);
CREATE INDEX IF NOT EXISTS inbound_mail_events_org_status_idx
  ON inbound_mail_events(organization_id, status, received_at DESC);

ALTER TABLE attachments
  ADD COLUMN IF NOT EXISTS lifecycle_status text NOT NULL DEFAULT 'uploaded',
  ADD COLUMN IF NOT EXISTS classification text NOT NULL DEFAULT 'internal',
  ADD COLUMN IF NOT EXISTS scan_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS retention_until timestamptz,
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='attachments'::regclass AND conname='attachments_lifecycle_status_check') THEN
    ALTER TABLE attachments ADD CONSTRAINT attachments_lifecycle_status_check
      CHECK (lifecycle_status IN ('pending','uploaded','quarantined','clean','rejected','archived'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='attachments'::regclass AND conname='attachments_scan_status_check') THEN
    ALTER TABLE attachments ADD CONSTRAINT attachments_scan_status_check
      CHECK (scan_status IN ('pending','clean','infected','failed','not_applicable'));
  END IF;
END $$;

-- Preserve access to pre-T01 attachments without pretending they were malware-scanned.
-- New uploads are explicitly scanned by the application and stored as scan_status='clean'.
UPDATE attachments
SET lifecycle_status='clean', scan_status='not_applicable'
WHERE content IS NOT NULL
  AND lifecycle_status='uploaded'
  AND scan_status='pending';

CREATE TABLE IF NOT EXISTS tag_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  entity_type text NOT NULL,
  name text NOT NULL,
  color text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, entity_type, name)
);

CREATE TABLE IF NOT EXISTS entity_tags (
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  tag_id uuid NOT NULL REFERENCES tag_definitions(id) ON DELETE CASCADE,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  assigned_by uuid REFERENCES users(id) ON DELETE SET NULL,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, tag_id, entity_type, entity_id)
);
CREATE INDEX IF NOT EXISTS entity_tags_lookup_idx
  ON entity_tags(organization_id, entity_type, entity_id);

CREATE TABLE IF NOT EXISTS developer_apps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked')),
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);
CREATE INDEX IF NOT EXISTS developer_apps_org_idx ON developer_apps(organization_id, created_at DESC);

CREATE TABLE IF NOT EXISTS api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  developer_app_id uuid REFERENCES developer_apps(id) ON DELETE CASCADE,
  name text NOT NULL,
  key_prefix text NOT NULL,
  key_hash char(64) NOT NULL,
  scopes text[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked','expired')),
  expires_at timestamptz,
  last_used_at timestamptz,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  UNIQUE (organization_id, key_hash)
);
CREATE INDEX IF NOT EXISTS api_keys_org_status_idx ON api_keys(organization_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS api_keys_prefix_idx ON api_keys(key_prefix) WHERE status='active';

CREATE TABLE IF NOT EXISTS oauth_states (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('google','microsoft')),
  state_hash char(64) NOT NULL,
  redirect_uri text NOT NULL,
  requested_scopes text[] NOT NULL DEFAULT '{}',
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, state_hash)
);
CREATE INDEX IF NOT EXISTS oauth_states_expiry_idx ON oauth_states(expires_at) WHERE consumed_at IS NULL;

CREATE TABLE IF NOT EXISTS oauth_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  provider text NOT NULL CHECK (provider IN ('google','microsoft')),
  provider_account_id text,
  provider_account_label text,
  scopes text[] NOT NULL DEFAULT '{}',
  encrypted_credentials jsonb NOT NULL,
  credential_version integer NOT NULL DEFAULT 1 CHECK (credential_version > 0),
  expires_at timestamptz,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','expired','revoked','error')),
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  UNIQUE (organization_id, user_id, provider)
);
CREATE INDEX IF NOT EXISTS oauth_connections_org_status_idx
  ON oauth_connections(organization_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS configuration_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  namespace text NOT NULL,
  config_key text NOT NULL,
  value jsonb NOT NULL,
  effective_from timestamptz NOT NULL DEFAULT now(),
  effective_to timestamptz,
  version integer NOT NULL CHECK (version > 0),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('draft','active','superseded','cancelled')),
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (effective_to IS NULL OR effective_to > effective_from),
  UNIQUE (organization_id, namespace, config_key, version)
);
CREATE INDEX IF NOT EXISTS configuration_versions_effective_idx
  ON configuration_versions(organization_id, namespace, config_key, effective_from DESC);

CREATE TABLE IF NOT EXISTS feature_flags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  flag_key text NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  rules jsonb NOT NULL DEFAULT '{}'::jsonb,
  effective_from timestamptz NOT NULL DEFAULT now(),
  effective_to timestamptz,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (effective_to IS NULL OR effective_to > effective_from),
  UNIQUE (organization_id, flag_key, version)
);
CREATE INDEX IF NOT EXISTS feature_flags_effective_idx
  ON feature_flags(organization_id, flag_key, effective_from DESC);

CREATE TABLE IF NOT EXISTS privacy_retention_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  data_class text NOT NULL,
  retention_days integer NOT NULL CHECK (retention_days BETWEEN 1 AND 36500),
  legal_basis text NOT NULL,
  effective_from timestamptz NOT NULL DEFAULT now(),
  effective_to timestamptz,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (effective_to IS NULL OR effective_to > effective_from),
  UNIQUE (organization_id, data_class, version)
);

CREATE TABLE IF NOT EXISTS privacy_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  request_type text NOT NULL CHECK (request_type IN ('access','export','correction','restriction','erasure','consent_withdrawal')),
  subject_reference text NOT NULL,
  status text NOT NULL DEFAULT 'received'
    CHECK (status IN ('received','verified','in_progress','completed','rejected','cancelled')),
  request_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  result_payload jsonb,
  requested_by uuid REFERENCES users(id) ON DELETE SET NULL,
  assigned_to uuid REFERENCES users(id) ON DELETE SET NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS privacy_requests_org_status_idx
  ON privacy_requests(organization_id, status, requested_at DESC);

CREATE TABLE IF NOT EXISTS report_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  dataset_key text NOT NULL,
  columns jsonb NOT NULL DEFAULT '[]'::jsonb,
  filters jsonb NOT NULL DEFAULT '{}'::jsonb,
  schedule jsonb,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS report_definitions_org_idx ON report_definitions(organization_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS report_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  report_definition_id uuid REFERENCES report_definitions(id) ON DELETE SET NULL,
  dataset_key text NOT NULL,
  filters jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','succeeded','failed','cancelled')),
  row_count integer CHECK (row_count IS NULL OR row_count >= 0),
  output_reference text,
  error_message text,
  requested_by uuid REFERENCES users(id) ON DELETE SET NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz
);
CREATE INDEX IF NOT EXISTS report_runs_org_status_idx ON report_runs(organization_id, status, requested_at DESC);

CREATE TABLE IF NOT EXISTS ai_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  policy_key text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  allow_read boolean NOT NULL DEFAULT true,
  allow_propose boolean NOT NULL DEFAULT true,
  allow_execute boolean NOT NULL DEFAULT false,
  requires_approval boolean NOT NULL DEFAULT true,
  allowed_tools text[] NOT NULL DEFAULT '{}',
  data_classes text[] NOT NULL DEFAULT '{}',
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, policy_key, version)
);

CREATE TABLE IF NOT EXISTS ai_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  policy_key text NOT NULL,
  request_type text NOT NULL CHECK (request_type IN ('read','propose','execute')),
  prompt_hash char(64) NOT NULL,
  context_manifest jsonb NOT NULL DEFAULT '{}'::jsonb,
  provenance jsonb NOT NULL DEFAULT '[]'::jsonb,
  model_identifier text,
  status text NOT NULL DEFAULT 'received' CHECK (status IN ('received','approved','completed','blocked','failed')),
  output_digest char(64),
  uncertainty numeric(6,5) CHECK (uncertainty IS NULL OR (uncertainty >= 0 AND uncertainty <= 1)),
  action_key text,
  approval_request_id uuid REFERENCES approval_requests(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
CREATE INDEX IF NOT EXISTS ai_requests_org_status_idx ON ai_requests(organization_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS ai_evaluations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  ai_request_id uuid REFERENCES ai_requests(id) ON DELETE CASCADE,
  evaluation_key text NOT NULL,
  score numeric(8,5) NOT NULL,
  threshold numeric(8,5),
  passed boolean NOT NULL,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  evaluated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_evaluations_request_idx ON ai_evaluations(organization_id, ai_request_id, evaluated_at DESC);

INSERT INTO permissions (key, name, category, description) VALUES
  ('integrations.manage', 'Manage integrations', 'Integrations', 'Create/revoke tenant API keys and OAuth connections.'),
  ('platform.configuration.manage', 'Manage platform configuration', 'Platform', 'Manage effective-dated shared configuration and feature flags.'),
  ('platform.extensibility.manage', 'Manage controlled extensibility', 'Platform', 'Manage shared tag definitions and governed extensibility metadata.'),
  ('platform.privacy.manage', 'Manage shared privacy controls', 'Governance', 'Manage tenant-level retention policies and data-subject requests.'),
  ('platform.reports.manage', 'Manage shared reports', 'Reporting', 'Manage shared report definitions and execution evidence.'),
  ('platform.ai.manage', 'Manage AI governance', 'AI', 'Manage AI policies, request evidence and evaluations.'),
  ('platform.workflows.manage', 'Manage platform workflows', 'Automation', 'Manage and execute shared workflow definitions.')
ON CONFLICT (key) DO UPDATE SET
  name=EXCLUDED.name, category=EXCLUDED.category, description=EXCLUDED.description;

INSERT INTO role_permissions (role_id, permission_key)
SELECT role.id, permission.permission_key
FROM roles role
CROSS JOIN (VALUES
  ('integrations.manage'),
  ('platform.configuration.manage'),
  ('platform.extensibility.manage'),
  ('platform.privacy.manage'),
  ('platform.reports.manage'),
  ('platform.ai.manage'),
  ('platform.workflows.manage')
) AS permission(permission_key)
WHERE role.slug IN ('organization_owner','system_administrator')
ON CONFLICT DO NOTHING;

-- T01 platform-governance authorities are organisation/system-level. Keep
-- existing Company Administrator rows aligned with the canonical role template
-- used for newly provisioned organisations.
DELETE FROM role_permissions rp
USING roles role
WHERE rp.role_id=role.id
  AND role.slug='company_administrator'
  AND rp.permission_key IN (
    'integrations.manage',
    'platform.configuration.manage',
    'platform.extensibility.manage',
    'platform.privacy.manage',
    'platform.reports.manage',
    'platform.ai.manage',
    'platform.workflows.manage'
  );

COMMIT;
