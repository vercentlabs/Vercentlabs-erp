BEGIN;

ALTER TABLE tenant.crm_leads
  ADD COLUMN IF NOT EXISTS qualification_state text NOT NULL DEFAULT 'not_reviewed',
  ADD COLUMN IF NOT EXISTS qualification_reason_code text,
  ADD COLUMN IF NOT EXISTS qualification_reason_text text,
  ADD COLUMN IF NOT EXISTS qualification_note text,
  ADD COLUMN IF NOT EXISTS qualification_decided_at timestamptz,
  ADD COLUMN IF NOT EXISTS qualification_decided_by_user_id uuid REFERENCES public.users(id) ON DELETE RESTRICT;

-- Preserve historical meaning without rewriting the lifecycle status that
-- predates F006. All new decisions use qualification_state exclusively.
UPDATE tenant.crm_leads
SET qualification_state = CASE
      WHEN status = 'qualified' THEN 'qualified'
      WHEN status = 'unqualified' THEN 'unqualified'
      ELSE 'not_reviewed'
    END,
    qualification_reason_code = CASE
      WHEN status = 'unqualified' THEN 'other'
      ELSE NULL
    END,
    qualification_reason_text = CASE
      WHEN status = 'unqualified' THEN COALESCE(NULLIF(btrim(unqualified_reason), ''), 'Historical unqualified Lead')
      ELSE NULL
    END,
    qualification_decided_at = CASE
      WHEN status IN ('qualified', 'unqualified') THEN updated_at
      ELSE NULL
    END,
    qualification_decided_by_user_id = CASE
      WHEN status IN ('qualified', 'unqualified') THEN COALESCE(updated_by, created_by)
      ELSE NULL
    END
WHERE qualification_state = 'not_reviewed'
  AND status IN ('qualified', 'unqualified')
  AND COALESCE(updated_by, created_by) IS NOT NULL;

-- F007 will own lifecycle vocabulary. Retire the historical misuse of the
-- two decision words as lifecycle stages while retaining their decisions
-- above. Working is the least-assumptive active lifecycle compatibility state.
UPDATE tenant.crm_leads
SET status = 'working', updated_at = now()
WHERE status IN ('qualified', 'unqualified');

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'tenant.crm_leads'::regclass
      AND conname = 'crm_leads_qualification_state_check'
  ) THEN
    ALTER TABLE tenant.crm_leads
      ADD CONSTRAINT crm_leads_qualification_state_check
      CHECK (qualification_state IN ('not_reviewed', 'qualified', 'unqualified')) NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'tenant.crm_leads'::regclass
      AND conname = 'crm_leads_qualification_decision_check'
  ) THEN
    ALTER TABLE tenant.crm_leads
      ADD CONSTRAINT crm_leads_qualification_decision_check
      CHECK (
        (qualification_state = 'not_reviewed'
          AND qualification_reason_code IS NULL
          AND qualification_reason_text IS NULL
          AND qualification_note IS NULL
          AND qualification_decided_at IS NULL
          AND qualification_decided_by_user_id IS NULL)
        OR
        (qualification_state = 'qualified'
          AND qualification_reason_code IS NULL
          AND qualification_reason_text IS NULL
          AND qualification_decided_at IS NOT NULL
          AND qualification_decided_by_user_id IS NOT NULL)
        OR
        (qualification_state = 'unqualified'
          AND qualification_reason_code IS NOT NULL
          AND qualification_reason_code IN (
            'no_current_requirement', 'not_a_fit', 'invalid_enquiry',
            'unable_to_reach', 'budget_unavailable',
            'duplicate_or_existing_relationship', 'other'
          )
          AND qualification_decided_at IS NOT NULL
          AND qualification_decided_by_user_id IS NOT NULL
          AND (qualification_reason_code <> 'other' OR length(btrim(qualification_reason_text)) >= 3))
      ) NOT VALID;
  END IF;
END $$;

ALTER TABLE tenant.crm_leads
  VALIDATE CONSTRAINT crm_leads_qualification_state_check;
ALTER TABLE tenant.crm_leads
  VALIDATE CONSTRAINT crm_leads_qualification_decision_check;

CREATE INDEX IF NOT EXISTS crm_leads_qualification_idx
  ON tenant.crm_leads(organization_id, qualification_state, updated_at DESC)
  WHERE status <> 'archived';

CREATE TABLE IF NOT EXISTS tenant.crm_lead_qualification_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL,
  previous_state text NOT NULL CHECK (previous_state IN ('not_reviewed', 'qualified', 'unqualified')),
  new_state text NOT NULL CHECK (new_state IN ('qualified', 'unqualified')),
  reason_code text,
  reason_text text,
  note text,
  decided_by_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, lead_id)
    REFERENCES tenant.crm_leads(organization_id, id) ON DELETE CASCADE,
  CHECK (previous_state <> new_state),
  CHECK (
    (new_state = 'qualified' AND reason_code IS NULL AND reason_text IS NULL)
    OR
    (new_state = 'unqualified'
      AND reason_code IS NOT NULL
      AND reason_code IN (
        'no_current_requirement', 'not_a_fit', 'invalid_enquiry',
        'unable_to_reach', 'budget_unavailable',
        'duplicate_or_existing_relationship', 'other'
      )
      AND (reason_code <> 'other' OR length(btrim(reason_text)) >= 3))
  )
);

CREATE INDEX IF NOT EXISTS crm_lead_qualification_events_lead_idx
  ON tenant.crm_lead_qualification_events(organization_id, lead_id, created_at DESC, id DESC);

INSERT INTO tenant.crm_lead_qualification_events (
  organization_id, lead_id, previous_state, new_state, reason_code,
  reason_text, note, decided_by_user_id, created_at
)
SELECT organization_id, id, 'not_reviewed', qualification_state,
       qualification_reason_code, qualification_reason_text,
       qualification_note, qualification_decided_by_user_id,
       qualification_decided_at
FROM tenant.crm_leads lead
WHERE qualification_state IN ('qualified', 'unqualified')
  AND qualification_decided_by_user_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM tenant.crm_lead_qualification_events event
    WHERE event.organization_id=lead.organization_id AND event.lead_id=lead.id
  );

CREATE OR REPLACE FUNCTION tenant.crm_lead_qualification_event_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Cascades from deleting a parent Lead/organization are governed parent
  -- operations and must remain possible. A direct history mutation executes
  -- at trigger depth one and is always rejected.
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Lead Qualification history is immutable';
END;
$$;

DROP TRIGGER IF EXISTS crm_lead_qualification_events_immutable
  ON tenant.crm_lead_qualification_events;
CREATE TRIGGER crm_lead_qualification_events_immutable
BEFORE UPDATE OR DELETE ON tenant.crm_lead_qualification_events
FOR EACH ROW EXECUTE FUNCTION tenant.crm_lead_qualification_event_immutable();

ALTER TABLE tenant.crm_lead_qualification_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.crm_lead_qualification_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_organization_isolation ON tenant.crm_lead_qualification_events;
CREATE POLICY tenant_organization_isolation ON tenant.crm_lead_qualification_events
  USING (organization_id = current_setting('app.current_organization_id', true)::uuid)
  WITH CHECK (organization_id = current_setting('app.current_organization_id', true)::uuid);

COMMENT ON COLUMN tenant.crm_leads.qualification_state IS
  'Canonical F006 decision; independent of Lead lifecycle status and score.';
COMMENT ON TABLE tenant.crm_lead_qualification_events IS
  'Immutable-by-application F006 Lead Qualification transition ledger.';

COMMIT;
