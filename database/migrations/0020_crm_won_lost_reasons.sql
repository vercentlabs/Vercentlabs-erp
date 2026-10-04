-- Won / Lost Reasons.
--
-- 1. Close reasons (tenant.crm_lost_reasons holds both kinds, by outcome_type):
--    per-reason rules (notes required, competitor captured or required, a
--    future follow-up offered, a link to the original opportunity), and the
--    locked default Won and Lost lists for every organization. Existing codes
--    are kept, so reasons already used keep their id.
-- 2. Opportunities record who closed them and, for a duplicate, the
--    opportunity it duplicates.
-- 3. tenant.crm_opportunity_close_history: every close, kept through reopens
--    and corrections, so reopening never erases the earlier outcome.
-- 4. A closed opportunity keeps the stage it closed in as its stage (the final
--    stage); closed deals that were moved to a Won/Lost stage return to it.
-- 5. Permissions: correct a closed opportunity's reason, manage the reasons.

-- ============================================================ 1. close reasons

ALTER TABLE tenant.crm_lost_reasons
  ADD COLUMN IF NOT EXISTS requires_notes boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS captures_competitor boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS requires_competitor boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS offers_follow_up boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS links_duplicate boolean NOT NULL DEFAULT false;

CREATE TEMP TABLE close_reason_defaults (code text, name text, category text, outcome_type text, sequence int,
  requires_notes boolean, captures_competitor boolean, requires_competitor boolean, offers_follow_up boolean, links_duplicate boolean) ON COMMIT DROP;
INSERT INTO close_reason_defaults VALUES
  ('best_fit', 'Best Product / Solution Fit', 'fit', 'won', 10, false, false, false, false, false),
  ('better_pricing', 'Better Pricing / Commercials', 'price', 'won', 20, false, false, false, false, false),
  ('strong_relationship', 'Strong Customer Relationship', 'other', 'won', 30, false, false, false, false, false),
  ('better_features', 'Better Features / Capabilities', 'fit', 'won', 40, false, false, false, false, false),
  ('faster_implementation', 'Faster Implementation', 'timing', 'won', 50, false, false, false, false, false),
  ('existing_customer', 'Existing Customer / Expansion', 'other', 'won', 60, false, false, false, false, false),
  ('strong_support', 'Strong Support / Service', 'other', 'won', 70, false, false, false, false, false),
  ('preferred_vendor', 'Preferred Vendor', 'other', 'won', 80, false, false, false, false, false),
  ('competitor_weakness', 'Competitor Weakness', 'competition', 'won', 90, false, true, false, false, false),
  ('won_other', 'Other', 'other', 'won', 100, true, false, false, false, false),
  ('price_too_high', 'Price Too High', 'price', 'lost', 10, false, false, false, false, false),
  ('competitor_selected', 'Competitor Selected', 'competition', 'lost', 20, false, true, true, false, false),
  ('no_budget', 'No Budget', 'budget', 'lost', 30, false, false, false, true, false),
  ('project_cancelled', 'Project Cancelled', 'other', 'lost', 40, false, false, false, false, false),
  ('decision_delayed', 'Decision Delayed', 'timing', 'lost', 50, false, false, false, true, false),
  ('no_decision', 'No Decision', 'timing', 'lost', 60, false, false, false, false, false),
  ('requirements_not_met', 'Requirements Not Met', 'fit', 'lost', 70, false, false, false, false, false),
  ('product_gap', 'Product / Feature Gap', 'fit', 'lost', 80, false, false, false, false, false),
  ('implementation_concerns', 'Implementation Concerns', 'fit', 'lost', 90, false, false, false, false, false),
  ('customer_unresponsive', 'Customer Unresponsive', 'no_response', 'lost', 100, false, false, false, false, false),
  ('poor_fit', 'Poor Fit', 'fit', 'lost', 110, false, false, false, false, false),
  ('timing_not_suitable', 'Timing Not Suitable', 'timing', 'lost', 120, false, false, false, true, false),
  ('internal_decision', 'Internal Customer Decision', 'other', 'lost', 130, false, false, false, false, false),
  ('duplicate_opportunity', 'Duplicate Opportunity', 'duplicate', 'lost', 140, false, false, false, false, true),
  ('other', 'Other', 'other', 'lost', 150, true, false, false, false, false);

-- Reasons an organization already has under these codes take the standard rules (their names stay as the organization set them).
UPDATE tenant.crm_lost_reasons reason
   SET requires_notes = d.requires_notes, captures_competitor = d.captures_competitor, requires_competitor = d.requires_competitor,
       offers_follow_up = d.offers_follow_up, links_duplicate = d.links_duplicate,
       name = CASE WHEN reason.code = 'internal_decision' AND reason.name = 'Internal Decision' THEN d.name ELSE reason.name END
  FROM close_reason_defaults d
 WHERE d.code = reason.code;

-- Every organization gets the standard reasons it does not have yet.
INSERT INTO tenant.crm_lost_reasons (organization_id, name, code, category, outcome_type, sequence, requires_notes, captures_competitor, requires_competitor, offers_follow_up, links_duplicate)
SELECT organization.id, d.name, d.code, d.category, d.outcome_type, d.sequence, d.requires_notes, d.captures_competitor, d.requires_competitor, d.offers_follow_up, d.links_duplicate
  FROM public.organizations organization CROSS JOIN close_reason_defaults d
 WHERE EXISTS (SELECT 1 FROM tenant.crm_lost_reasons existing WHERE existing.organization_id = organization.id)
ON CONFLICT (organization_id, code) DO NOTHING;

-- "Other" always asks for an explanation.
UPDATE tenant.crm_lost_reasons SET requires_notes = true WHERE code IN ('other', 'won_other');

-- ============================================================ 2. opportunity columns

ALTER TABLE tenant.crm_opportunities
  ADD COLUMN IF NOT EXISTS closed_by uuid REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS duplicate_of_opportunity_id uuid REFERENCES tenant.crm_opportunities(id);

-- ============================================================ 3. close history

CREATE TABLE tenant.crm_opportunity_close_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  opportunity_id uuid NOT NULL REFERENCES tenant.crm_opportunities(id) ON DELETE CASCADE,
  outcome text NOT NULL CHECK (outcome IN ('won', 'lost')),
  reason_id uuid REFERENCES tenant.crm_lost_reasons(id),
  reason_name text,
  notes text,
  competitor_name text,
  duplicate_of_opportunity_id uuid REFERENCES tenant.crm_opportunities(id),
  final_stage_id uuid REFERENCES tenant.crm_pipeline_stages(id),
  final_stage_name text,
  estimated_value numeric(18, 2),
  final_value numeric(18, 2),
  winning_quotation_id uuid,
  actual_close_date date NOT NULL,
  closed_by uuid REFERENCES public.users(id),
  closed_at timestamptz NOT NULL DEFAULT now(),
  corrected_at timestamptz,
  corrected_by uuid REFERENCES public.users(id),
  correction_reason text,
  reopened_at timestamptz,
  reopened_by uuid REFERENCES public.users(id),
  reopen_reason text,
  reopened_to_stage_id uuid REFERENCES tenant.crm_pipeline_stages(id)
);
CREATE INDEX crm_opportunity_close_history_opportunity_idx ON tenant.crm_opportunity_close_history (organization_id, opportunity_id, closed_at DESC);
CREATE INDEX crm_opportunity_close_history_reason_idx ON tenant.crm_opportunity_close_history (organization_id, outcome, actual_close_date);

ALTER TABLE tenant.crm_opportunity_close_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.crm_opportunity_close_history FORCE ROW LEVEL SECURITY;
CREATE POLICY organization_isolation ON tenant.crm_opportunity_close_history USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id());
GRANT SELECT, INSERT, UPDATE ON TABLE tenant.crm_opportunity_close_history TO vercent_app;
GRANT SELECT ON TABLE tenant.crm_opportunity_close_history TO vercent_worker;

-- ============================================================ 4. final stage, closed by, existing closes

DO $$ BEGIN PERFORM set_config('app.crm_opportunity_lifecycle_transition', 'allowed', true); END $$;

UPDATE tenant.crm_opportunities
   SET closed_by = COALESCE(closed_by, won_by, lost_by)
 WHERE status IN ('won', 'lost');

-- A closed deal keeps the stage it closed in.
UPDATE tenant.crm_opportunities opportunity
   SET stage_id = opportunity.stage_before_close_id
  FROM tenant.crm_pipeline_stages current_stage
 WHERE opportunity.status IN ('won', 'lost') AND opportunity.stage_before_close_id IS NOT NULL
   AND current_stage.organization_id = opportunity.organization_id AND current_stage.id = opportunity.stage_id
   AND (current_stage.is_won OR current_stage.is_lost);

INSERT INTO tenant.crm_opportunity_close_history (organization_id, opportunity_id, outcome, reason_id, reason_name, notes, competitor_name, final_stage_id, final_stage_name,
  estimated_value, final_value, winning_quotation_id, actual_close_date, closed_by, closed_at)
SELECT opportunity.organization_id, opportunity.id, opportunity.status, COALESCE(opportunity.outcome_reason_id, opportunity.lost_reason_id), reason.name,
       COALESCE(opportunity.outcome_notes, opportunity.loss_notes), opportunity.competitor_name, opportunity.stage_id, stage.name,
       opportunity.amount, opportunity.won_amount, opportunity.winning_quotation_id,
       COALESCE(opportunity.actual_close_date, opportunity.closed_at::date, opportunity.updated_at::date), opportunity.closed_by, COALESCE(opportunity.closed_at, opportunity.updated_at)
  FROM tenant.crm_opportunities opportunity
  LEFT JOIN tenant.crm_lost_reasons reason ON reason.organization_id = opportunity.organization_id AND reason.id = COALESCE(opportunity.outcome_reason_id, opportunity.lost_reason_id)
  LEFT JOIN tenant.crm_pipeline_stages stage ON stage.organization_id = opportunity.organization_id AND stage.id = opportunity.stage_id
 WHERE opportunity.status IN ('won', 'lost');

DO $$ BEGIN PERFORM set_config('app.crm_opportunity_lifecycle_transition', '', true); END $$;

-- ============================================================ 5. permissions

INSERT INTO public.permissions (key, name, category, description) VALUES
  ('crm.opportunities.edit_close_reason', 'Correct close reason', 'CRM', 'Correct the won or lost reason of a closed opportunity, with a reason that is kept in its history.'),
  ('crm.opportunities.manage_close_reasons', 'Manage won and lost reasons', 'CRM', 'Add, rename, reorder and deactivate the won and lost reasons.')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_key)
SELECT DISTINCT existing.role_id, 'crm.opportunities.edit_close_reason'
  FROM public.role_permissions existing WHERE existing.permission_key = 'crm.opportunities.reopen'
ON CONFLICT DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_key)
SELECT DISTINCT existing.role_id, 'crm.opportunities.manage_close_reasons'
  FROM public.role_permissions existing WHERE existing.permission_key = 'crm.settings.manage'
ON CONFLICT DO NOTHING;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0020_crm_won_lost_reasons.sql', 'crm-won-lost-reasons');
