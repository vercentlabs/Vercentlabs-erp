BEGIN;

-- Add a standard pipeline only when its code is missing. It becomes the default
-- only when the organization has no active default pipeline of its own.
INSERT INTO tenant.crm_pipelines (
  organization_id, name, code, description, is_default, created_by, updated_by
)
SELECT
  organization.id,
  'Standard sales pipeline',
  'STANDARD',
  'Default lead-to-customer opportunity pipeline.',
  NOT EXISTS (
    SELECT 1
    FROM tenant.crm_pipelines existing
    WHERE existing.organization_id = organization.id
      AND existing.status = 'active'
      AND existing.is_default
  ),
  organization.created_by,
  organization.created_by
FROM public.organizations organization
ON CONFLICT (organization_id, code) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  status = 'active',
  updated_by = EXCLUDED.updated_by;

INSERT INTO tenant.crm_pipeline_stages (
  organization_id, pipeline_id, name, code, sequence, probability,
  forecast_category, is_won, is_lost, stale_after_days,
  created_by, updated_by
)
SELECT
  pipeline.organization_id,
  pipeline.id,
  stage.name,
  stage.code,
  stage.sequence,
  stage.probability,
  stage.forecast_category,
  stage.is_won,
  stage.is_lost,
  stage.stale_after_days,
  organization.created_by,
  organization.created_by
FROM tenant.crm_pipelines pipeline
JOIN public.organizations organization ON organization.id = pipeline.organization_id
CROSS JOIN (
  VALUES
    ('Qualification', 'QUALIFICATION', 10, 10::numeric, 'pipeline', false, false, 7),
    ('Needs analysis', 'NEEDS_ANALYSIS', 20, 25::numeric, 'pipeline', false, false, 10),
    ('Value proposition', 'VALUE_PROPOSITION', 30, 40::numeric, 'best_case', false, false, 14),
    ('Proposal', 'PROPOSAL', 40, 60::numeric, 'best_case', false, false, 14),
    ('Negotiation', 'NEGOTIATION', 50, 80::numeric, 'committed', false, false, 10),
    ('Closed won', 'CLOSED_WON', 60, 100::numeric, 'closed', true, false, NULL::integer),
    ('Closed lost', 'CLOSED_LOST', 70, 0::numeric, 'closed', false, true, NULL::integer)
) AS stage(name, code, sequence, probability, forecast_category, is_won, is_lost, stale_after_days)
WHERE pipeline.code = 'STANDARD'
-- Existing organisations may have customised the standard pipeline. Avoid
-- overwriting or colliding with customer-defined stage sequences while filling
-- only missing defaults.
ON CONFLICT DO NOTHING;

INSERT INTO tenant.crm_settings (
  organization_id, default_pipeline_id, default_currency_code,
  created_by, updated_by
)
SELECT
  organization.id,
  COALESCE(default_pipeline.id, standard_pipeline.id),
  company.base_currency,
  organization.created_by,
  organization.created_by
FROM public.organizations organization
LEFT JOIN LATERAL (
  SELECT pipeline.id
  FROM tenant.crm_pipelines pipeline
  WHERE pipeline.organization_id = organization.id
    AND pipeline.status = 'active'
    AND pipeline.is_default
  ORDER BY pipeline.updated_at DESC
  LIMIT 1
) default_pipeline ON true
LEFT JOIN tenant.crm_pipelines standard_pipeline
  ON standard_pipeline.organization_id = organization.id
 AND standard_pipeline.code = 'STANDARD'
LEFT JOIN LATERAL (
  SELECT candidate.base_currency
  FROM public.companies candidate
  WHERE candidate.organization_id = organization.id
  ORDER BY candidate.is_primary DESC, candidate.created_at
  LIMIT 1
) company ON true
ON CONFLICT (organization_id) DO UPDATE SET
  default_pipeline_id = COALESCE(tenant.crm_settings.default_pipeline_id, EXCLUDED.default_pipeline_id),
  default_currency_code = COALESCE(tenant.crm_settings.default_currency_code, EXCLUDED.default_currency_code),
  updated_by = EXCLUDED.updated_by;

INSERT INTO tenant.crm_lead_sources (
  organization_id, name, code, channel, is_default, created_by, updated_by
)
SELECT organization.id, source.name, source.code, source.channel, source.is_default,
       organization.created_by, organization.created_by
FROM public.organizations organization
CROSS JOIN (
  VALUES
    ('Website', 'WEBSITE', 'website', true),
    ('Referral', 'REFERRAL', 'referral', false),
    ('Partner', 'PARTNER', 'partner', false),
    ('Event', 'EVENT', 'event', false),
    ('Phone enquiry', 'PHONE', 'phone', false),
    ('Walk-in', 'WALK_IN', 'walk_in', false),
    ('Import', 'IMPORT', 'import', false),
    ('Other', 'OTHER', 'other', false)
) AS source(name, code, channel, is_default)
ON CONFLICT (organization_id, code) DO UPDATE SET
  name = EXCLUDED.name,
  channel = EXCLUDED.channel,
  status = 'active',
  updated_by = EXCLUDED.updated_by;

INSERT INTO tenant.crm_lost_reasons (
  organization_id, name, code, category, created_by, updated_by
)
SELECT organization.id, reason.name, reason.code, reason.category,
       organization.created_by, organization.created_by
FROM public.organizations organization
CROSS JOIN (
  VALUES
    ('Price too high', 'PRICE', 'price'),
    ('Lost to competitor', 'COMPETITION', 'competition'),
    ('No budget', 'NO_BUDGET', 'budget'),
    ('Timing not right', 'TIMING', 'timing'),
    ('Not a fit', 'NOT_FIT', 'fit'),
    ('No response', 'NO_RESPONSE', 'no_response'),
    ('Duplicate', 'DUPLICATE', 'duplicate'),
    ('Other', 'OTHER', 'other')
) AS reason(name, code, category)
ON CONFLICT (organization_id, code) DO UPDATE SET
  name = EXCLUDED.name,
  category = EXCLUDED.category,
  status = 'active',
  updated_by = EXCLUDED.updated_by;

INSERT INTO tenant.crm_tags (
  organization_id, name, color, created_by, updated_by
)
SELECT organization.id, tag.name, tag.color,
       organization.created_by, organization.created_by
FROM public.organizations organization
CROSS JOIN (
  VALUES
    ('High intent', '#b91c1c'),
    ('Follow up', '#0369a1'),
    ('Enterprise', '#6d28d9'),
    ('SME', '#047857')
) AS tag(name, color)
ON CONFLICT (organization_id, name) DO UPDATE SET
  color = EXCLUDED.color,
  status = 'active',
  updated_by = EXCLUDED.updated_by;

INSERT INTO tenant.crm_sales_teams (
  organization_id, company_id, code, name, manager_user_id,
  default_pipeline_id, currency_code, created_by, updated_by
)
SELECT
  organization.id,
  company.id,
  'PRIMARY',
  'Primary sales team',
  organization.created_by,
  COALESCE(settings.default_pipeline_id, standard_pipeline.id),
  company.base_currency,
  organization.created_by,
  organization.created_by
FROM public.organizations organization
LEFT JOIN LATERAL (
  SELECT candidate.id, candidate.base_currency
  FROM public.companies candidate
  WHERE candidate.organization_id = organization.id
  ORDER BY candidate.is_primary DESC, candidate.created_at
  LIMIT 1
) company ON true
LEFT JOIN tenant.crm_settings settings ON settings.organization_id = organization.id
LEFT JOIN tenant.crm_pipelines standard_pipeline
  ON standard_pipeline.organization_id = organization.id
 AND standard_pipeline.code = 'STANDARD'
ON CONFLICT (organization_id, code) DO UPDATE SET
  company_id = COALESCE(tenant.crm_sales_teams.company_id, EXCLUDED.company_id),
  manager_user_id = COALESCE(tenant.crm_sales_teams.manager_user_id, EXCLUDED.manager_user_id),
  default_pipeline_id = COALESCE(tenant.crm_sales_teams.default_pipeline_id, EXCLUDED.default_pipeline_id),
  currency_code = COALESCE(tenant.crm_sales_teams.currency_code, EXCLUDED.currency_code),
  status = 'active',
  updated_by = EXCLUDED.updated_by;

COMMIT;
