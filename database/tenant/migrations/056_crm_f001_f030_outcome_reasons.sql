BEGIN;

-- F026 — make outcome reasons explicit for both won and lost opportunities
-- while keeping the historical crm_lost_reasons table backward compatible.
ALTER TABLE tenant.crm_lost_reasons
  ADD COLUMN IF NOT EXISTS outcome_type text NOT NULL DEFAULT 'lost';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'tenant.crm_lost_reasons'::regclass
      AND conname = 'crm_lost_reasons_outcome_type_check'
  ) THEN
    ALTER TABLE tenant.crm_lost_reasons
      ADD CONSTRAINT crm_lost_reasons_outcome_type_check
      CHECK (outcome_type IN ('won','lost','both')) NOT VALID;
  END IF;
END $$;

ALTER TABLE tenant.crm_lost_reasons
  VALIDATE CONSTRAINT crm_lost_reasons_outcome_type_check;

ALTER TABLE tenant.crm_opportunities
  ADD COLUMN IF NOT EXISTS outcome_reason_id uuid,
  ADD COLUMN IF NOT EXISTS outcome_notes text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'tenant.crm_opportunities'::regclass
      AND conname = 'crm_opportunities_outcome_reason_org_fkey'
  ) THEN
    ALTER TABLE tenant.crm_opportunities
      ADD CONSTRAINT crm_opportunities_outcome_reason_org_fkey
      FOREIGN KEY (organization_id, outcome_reason_id)
      REFERENCES tenant.crm_lost_reasons(organization_id, id)
      ON DELETE SET NULL (outcome_reason_id) NOT VALID;
  END IF;
END $$;

ALTER TABLE tenant.crm_opportunities
  VALIDATE CONSTRAINT crm_opportunities_outcome_reason_org_fkey;

-- Preserve existing closed-lost history in the new neutral columns.
UPDATE tenant.crm_opportunities
SET outcome_reason_id = COALESCE(outcome_reason_id, lost_reason_id),
    outcome_notes = COALESCE(outcome_notes, loss_notes)
WHERE status = 'lost'
  AND (outcome_reason_id IS NULL OR outcome_notes IS NULL);

-- Existing reasons remain lost reasons. Seed a small neutral won catalogue so
-- fresh tenants can close a won deal without first configuring setup.
INSERT INTO tenant.crm_lost_reasons (
  organization_id, name, code, category, outcome_type, created_by, updated_by
)
SELECT o.id, reason.name, reason.code, reason.category, 'won', o.created_by, o.created_by
FROM public.organizations o
CROSS JOIN (
  VALUES
    ('Product fit', 'WON_PRODUCT_FIT', 'fit'),
    ('Relationship and trust', 'WON_RELATIONSHIP', 'other'),
    ('Commercial terms', 'WON_COMMERCIAL', 'price'),
    ('Implementation confidence', 'WON_IMPLEMENTATION', 'fit'),
    ('Other', 'WON_OTHER', 'other')
) AS reason(name, code, category)
ON CONFLICT (organization_id, code) DO NOTHING;

COMMIT;
