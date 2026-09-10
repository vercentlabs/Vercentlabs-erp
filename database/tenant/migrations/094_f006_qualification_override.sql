BEGIN;

-- F006 Prompt 4: DEC-CRM-P1-F006 requires an "exception override" — an
-- elevated user can qualify a Lead despite unmet required evidence, with a
-- mandatory reason, audited distinctly from an ordinary decision. Recorded
-- only on the immutable event row (not on crm_leads) since it describes how
-- one specific decision was made, not an ongoing Lead property.
ALTER TABLE tenant.crm_lead_qualification_events
  ADD COLUMN IF NOT EXISTS override_used boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS override_reason text;

ALTER TABLE tenant.crm_lead_qualification_events
  DROP CONSTRAINT IF EXISTS crm_lead_qualification_events_override_reason_check,
  ADD CONSTRAINT crm_lead_qualification_events_override_reason_check
    CHECK (
      (NOT override_used AND override_reason IS NULL)
      OR (override_used AND override_reason IS NOT NULL AND length(btrim(override_reason)) >= 3 AND length(override_reason) <= 1000)
    );

COMMENT ON COLUMN tenant.crm_lead_qualification_events.override_used IS 'True when this decision qualified the Lead despite unmet required evidence via the governed exception-override path (DEC-CRM-P1-F006).';

COMMIT;
