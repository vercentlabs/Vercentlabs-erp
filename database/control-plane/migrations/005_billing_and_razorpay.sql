BEGIN;

CREATE EXTENSION IF NOT EXISTS citext;

INSERT INTO permissions (key, name, category, description) VALUES
  ('billing.view', 'View billing', 'Billing', 'View the organisation subscription, invoices, payments, usage and plan limits.'),
  ('billing.manage', 'Manage billing', 'Billing', 'Maintain billing profile, subscription changes and cancellation preferences.'),
  ('billing.checkout', 'Start checkout', 'Billing', 'Create and authorise a paid subscription through the configured payment provider.'),
  ('billing.audit', 'Audit billing', 'Billing', 'Review provider events, payment reconciliation and billing history.')
ON CONFLICT (key) DO UPDATE SET
  name = EXCLUDED.name,
  category = EXCLUDED.category,
  description = EXCLUDED.description;

WITH role_permission_seed(role_slug, permission_key) AS (
  VALUES
    ('organization_owner', 'billing.view'),
    ('organization_owner', 'billing.manage'),
    ('organization_owner', 'billing.checkout'),
    ('organization_owner', 'billing.audit'),
    ('system_administrator', 'billing.view'),
    ('system_administrator', 'billing.manage'),
    ('system_administrator', 'billing.checkout'),
    ('system_administrator', 'billing.audit'),
    ('company_administrator', 'billing.view'),
    ('finance_manager', 'billing.view'),
    ('finance_manager', 'billing.manage'),
    ('finance_manager', 'billing.checkout'),
    ('finance_manager', 'billing.audit'),
    ('auditor', 'billing.view'),
    ('auditor', 'billing.audit')
)
INSERT INTO role_permissions (role_id, permission_key)
SELECT r.id, seed.permission_key
FROM roles r
JOIN role_permission_seed seed ON seed.role_slug = r.slug
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS billing_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  display_order integer NOT NULL DEFAULT 0,
  trial_days integer NOT NULL DEFAULT 14 CHECK (trial_days BETWEEN 0 AND 90),
  is_public boolean NOT NULL DEFAULT true,
  features jsonb NOT NULL DEFAULT '[]'::jsonb,
  modules jsonb NOT NULL DEFAULT '[]'::jsonb,
  limits jsonb NOT NULL DEFAULT '{}'::jsonb,
  cost_model jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS billing_plan_prices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id uuid NOT NULL REFERENCES billing_plans(id) ON DELETE CASCADE,
  billing_period text NOT NULL CHECK (billing_period IN ('monthly', 'yearly', 'custom')),
  currency char(3) NOT NULL DEFAULT 'INR',
  amount_paise bigint NOT NULL CHECK (amount_paise >= 0),
  onboarding_fee_paise bigint NOT NULL DEFAULT 0 CHECK (onboarding_fee_paise >= 0),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  provider text NOT NULL DEFAULT 'razorpay',
  provider_plan_id text,
  active boolean NOT NULL DEFAULT true,
  effective_at timestamptz NOT NULL DEFAULT now(),
  retired_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (plan_id, billing_period, version),
  UNIQUE (provider, provider_plan_id)
);

CREATE TABLE IF NOT EXISTS billing_customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL UNIQUE REFERENCES organizations(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'razorpay',
  provider_customer_id text,
  legal_name text NOT NULL DEFAULT '',
  billing_email citext,
  phone text,
  gstin text,
  billing_address jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_customer_id)
);

CREATE TABLE IF NOT EXISTS organization_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL UNIQUE REFERENCES organizations(id) ON DELETE CASCADE,
  plan_price_id uuid NOT NULL REFERENCES billing_plan_prices(id),
  provider text NOT NULL DEFAULT 'razorpay',
  provider_subscription_id text,
  status text NOT NULL CHECK (status IN (
    'trialing', 'checkout_pending', 'authenticated', 'active', 'past_due',
    'halted', 'cancelled', 'completed', 'expired', 'internal'
  )),
  provider_status text,
  billing_period text NOT NULL CHECK (billing_period IN ('monthly', 'yearly', 'custom')),
  trial_started_at timestamptz,
  trial_ends_at timestamptz,
  current_period_started_at timestamptz,
  current_period_ends_at timestamptz,
  grace_ends_at timestamptz,
  cancel_at_cycle_end boolean NOT NULL DEFAULT false,
  cancelled_at timestamptz,
  last_provider_event_at timestamptz,
  price_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  modules_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb,
  limits_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_subscription_id)
);

ALTER TABLE billing_plans
  ADD COLUMN IF NOT EXISTS modules jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE organization_subscriptions
  ADD COLUMN IF NOT EXISTS modules_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE TABLE IF NOT EXISTS billing_checkout_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  plan_price_id uuid NOT NULL REFERENCES billing_plan_prices(id),
  subscription_id uuid REFERENCES organization_subscriptions(id) ON DELETE SET NULL,
  provider text NOT NULL DEFAULT 'razorpay',
  provider_subscription_id text,
  status text NOT NULL DEFAULT 'created' CHECK (status IN ('created', 'authorised', 'failed', 'expired', 'superseded')),
  initiated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '30 minutes'),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS billing_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  subscription_id uuid REFERENCES organization_subscriptions(id) ON DELETE SET NULL,
  provider text NOT NULL DEFAULT 'razorpay',
  provider_payment_id text NOT NULL,
  provider_invoice_id text,
  amount_paise bigint NOT NULL DEFAULT 0,
  fee_paise bigint NOT NULL DEFAULT 0,
  tax_paise bigint NOT NULL DEFAULT 0,
  currency char(3) NOT NULL DEFAULT 'INR',
  status text NOT NULL DEFAULT 'created',
  method text,
  captured_at timestamptz,
  provider_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_payment_id)
);

CREATE TABLE IF NOT EXISTS billing_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  subscription_id uuid REFERENCES organization_subscriptions(id) ON DELETE SET NULL,
  provider text NOT NULL DEFAULT 'razorpay',
  provider_invoice_id text NOT NULL,
  amount_paise bigint NOT NULL DEFAULT 0,
  amount_due_paise bigint NOT NULL DEFAULT 0,
  amount_paid_paise bigint NOT NULL DEFAULT 0,
  tax_paise bigint NOT NULL DEFAULT 0,
  currency char(3) NOT NULL DEFAULT 'INR',
  status text NOT NULL DEFAULT 'issued',
  invoice_url text,
  issued_at timestamptz,
  paid_at timestamptz,
  provider_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_invoice_id)
);

CREATE TABLE IF NOT EXISTS billing_webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL DEFAULT 'razorpay',
  provider_event_id text NOT NULL,
  event_type text NOT NULL,
  organization_id uuid REFERENCES organizations(id) ON DELETE SET NULL,
  provider_created_at timestamptz,
  signature text,
  payload jsonb NOT NULL,
  processing_status text NOT NULL DEFAULT 'received' CHECK (processing_status IN ('received', 'processing', 'processed', 'ignored', 'failed')),
  processed_at timestamptz,
  processing_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_event_id)
);

ALTER TABLE billing_webhook_events
  DROP CONSTRAINT IF EXISTS billing_webhook_events_processing_status_check;
ALTER TABLE billing_webhook_events
  ADD CONSTRAINT billing_webhook_events_processing_status_check
  CHECK (processing_status IN ('received', 'processing', 'processed', 'ignored', 'failed'));

CREATE TABLE IF NOT EXISTS billing_usage_monthly (
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  month_start date NOT NULL,
  metric text NOT NULL,
  quantity bigint NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, month_start, metric)
);

CREATE TABLE IF NOT EXISTS billing_entitlement_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  entitlement_key text NOT NULL,
  entitlement_value jsonb NOT NULL,
  reason text NOT NULL DEFAULT '',
  expires_at timestamptz,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, entitlement_key)
);

CREATE INDEX IF NOT EXISTS billing_prices_public_idx ON billing_plan_prices(active, billing_period, amount_paise);
CREATE INDEX IF NOT EXISTS billing_subscriptions_status_idx ON organization_subscriptions(status, current_period_ends_at);
CREATE INDEX IF NOT EXISTS billing_checkouts_org_idx ON billing_checkout_sessions(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS billing_payments_org_idx ON billing_payments(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS billing_invoices_org_idx ON billing_invoices(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS billing_events_org_idx ON billing_webhook_events(organization_id, created_at DESC);

CREATE OR REPLACE FUNCTION touch_billing_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DO $$
DECLARE
  target_table text;
BEGIN
  FOREACH target_table IN ARRAY ARRAY[
    'billing_plans', 'billing_plan_prices', 'billing_customers',
    'organization_subscriptions', 'billing_checkout_sessions',
    'billing_payments', 'billing_invoices'
  ]
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I_touch_updated_at ON %I', target_table, target_table);
    EXECUTE format('CREATE TRIGGER %I_touch_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION touch_billing_updated_at()', target_table, target_table);
  END LOOP;
END;
$$;

INSERT INTO billing_plans (code, name, description, display_order, trial_days, is_public, features, modules, limits, cost_model) VALUES
  (
    'founder-preview', 'Founder Preview', 'Internal preview access for existing development organisations.', 0, 0, false,
    '["Unlimited users", "All released preview capabilities", "Development support"]'::jsonb,
    '["*"]'::jsonb,
    '{"companies": 25, "branches": 100, "storage_gb": 1000, "api_requests_monthly": 10000000, "automation_actions_monthly": 1000000, "outbound_messages_monthly": 1000000, "imports_rows_monthly": 1000000}'::jsonb,
    '{"estimated_direct_cost_paise": 0, "gateway_reserve_percent": 0, "minimum_margin_percent": 0}'::jsonb
  ),
  (
    'launch', 'Launch', 'For small businesses adopting CRM and connected core operations.', 10, 14, true,
    '["Unlimited users", "1 company and 2 branches", "CRM and master data", "Core platform controls", "Email support"]'::jsonb,
    '["crm"]'::jsonb,
    '{"companies": 1, "branches": 2, "storage_gb": 25, "api_requests_monthly": 100000, "automation_actions_monthly": 5000, "outbound_messages_monthly": 5000, "imports_rows_monthly": 25000}'::jsonb,
    '{"estimated_direct_cost_paise": 70000, "gateway_reserve_percent": 4, "minimum_margin_percent": 70}'::jsonb
  ),
  (
    'growth', 'Growth', 'For multi-team businesses connecting commercial and operational workflows.', 20, 14, true,
    '["Unlimited users", "3 companies and 10 branches", "All released base modules", "Advanced approvals", "Priority email support"]'::jsonb,
    '["crm", "sales", "procurement", "stock", "accounting", "support", "projects"]'::jsonb,
    '{"companies": 3, "branches": 10, "storage_gb": 100, "api_requests_monthly": 500000, "automation_actions_monthly": 25000, "outbound_messages_monthly": 25000, "imports_rows_monthly": 150000}'::jsonb,
    '{"estimated_direct_cost_paise": 180000, "gateway_reserve_percent": 4, "minimum_margin_percent": 70}'::jsonb
  ),
  (
    'scale', 'Scale', 'For growing multi-company organisations requiring deeper controls and higher usage.', 30, 14, true,
    '["Unlimited users", "10 companies and 50 branches", "Advanced controls and analytics", "Integration allowances", "Priority support"]'::jsonb,
    '["*"]'::jsonb,
    '{"companies": 10, "branches": 50, "storage_gb": 500, "api_requests_monthly": 2000000, "automation_actions_monthly": 100000, "outbound_messages_monthly": 100000, "imports_rows_monthly": 1000000}'::jsonb,
    '{"estimated_direct_cost_paise": 450000, "gateway_reserve_percent": 4, "minimum_margin_percent": 70}'::jsonb
  ),
  (
    'enterprise', 'Enterprise', 'For dedicated infrastructure, custom controls, migration programmes and contracted service levels.', 40, 0, true,
    '["Unlimited users", "Contracted organisation limits", "Dedicated or private deployment options", "Custom integrations", "Contracted SLA"]'::jsonb,
    '["*"]'::jsonb,
    '{"companies": 1000, "branches": 10000, "storage_gb": 10000, "api_requests_monthly": 100000000, "automation_actions_monthly": 10000000, "outbound_messages_monthly": 10000000, "imports_rows_monthly": 10000000}'::jsonb,
    '{"estimated_direct_cost_paise": 1800000, "gateway_reserve_percent": 4, "minimum_margin_percent": 70}'::jsonb
  )
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  display_order = EXCLUDED.display_order,
  trial_days = EXCLUDED.trial_days,
  is_public = EXCLUDED.is_public,
  features = EXCLUDED.features,
  modules = EXCLUDED.modules,
  limits = EXCLUDED.limits,
  cost_model = EXCLUDED.cost_model,
  status = 'active';

WITH prices(plan_code, billing_period, amount_paise, onboarding_fee_paise) AS (
  VALUES
    ('founder-preview', 'custom', 0::bigint, 0::bigint),
    ('launch', 'monthly', 399900::bigint, 0::bigint),
    ('launch', 'yearly', 3999000::bigint, 0::bigint),
    ('growth', 'monthly', 999900::bigint, 1999900::bigint),
    ('growth', 'yearly', 9999000::bigint, 1999900::bigint),
    ('scale', 'monthly', 2499900::bigint, 7499900::bigint),
    ('scale', 'yearly', 24999000::bigint, 7499900::bigint),
    ('enterprise', 'custom', 6000000::bigint, 20000000::bigint)
)
INSERT INTO billing_plan_prices (plan_id, billing_period, amount_paise, onboarding_fee_paise, version)
SELECT plan.id, prices.billing_period, prices.amount_paise, prices.onboarding_fee_paise, 1
FROM prices
JOIN billing_plans plan ON plan.code = prices.plan_code
ON CONFLICT (plan_id, billing_period, version) DO UPDATE SET
  amount_paise = EXCLUDED.amount_paise,
  onboarding_fee_paise = EXCLUDED.onboarding_fee_paise,
  active = true,
  retired_at = NULL;

INSERT INTO billing_customers (organization_id, legal_name, billing_email)
SELECT o.id, o.name, u.email
FROM organizations o
LEFT JOIN LATERAL (
  SELECT users.email
  FROM organization_memberships membership
  JOIN users ON users.id = membership.user_id
  WHERE membership.organization_id = o.id AND membership.role = 'owner'
  ORDER BY membership.created_at
  LIMIT 1
) u ON true
ON CONFLICT (organization_id) DO NOTHING;

INSERT INTO organization_subscriptions (
  organization_id, plan_price_id, status, billing_period,
  current_period_started_at, current_period_ends_at, grace_ends_at,
  price_snapshot, modules_snapshot, limits_snapshot, metadata
)
SELECT
  o.id,
  price.id,
  'internal',
  'custom',
  now(),
  now() + interval '90 days',
  now() + interval '97 days',
  jsonb_build_object('plan_code', plan.code, 'amount_paise', price.amount_paise, 'currency', price.currency),
  plan.modules,
  plan.limits,
  jsonb_build_object('source', 'billing-foundation-migration', 'preview_until', (now() + interval '90 days'))
FROM organizations o
JOIN billing_plans plan ON plan.code = 'founder-preview'
JOIN billing_plan_prices price ON price.plan_id = plan.id AND price.billing_period = 'custom' AND price.active
ON CONFLICT (organization_id) DO NOTHING;

COMMIT;
