BEGIN;

-- F009 requires a "controlled reopen preserving prior close events" lifecycle
-- and F026 requires that a reopen "creates a new event and preserves prior
-- close reason". crm_opportunity_stage_history was insert-only for
-- from/to stage but never recorded the outcome (status/reason/notes) that
-- applied to a given transition, so a close followed by a reopen had no
-- durable record of what the prior outcome actually was, and a later rename
-- of a crm_lost_reasons row would silently rewrite historical close reasons.
-- Snapshotting the reason's label at the moment of the transition fixes both.
ALTER TABLE tenant.crm_opportunity_stage_history
  ADD COLUMN IF NOT EXISTS status text,
  ADD COLUMN IF NOT EXISTS outcome_reason_id uuid REFERENCES tenant.crm_lost_reasons(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS outcome_reason_label text,
  ADD COLUMN IF NOT EXISTS outcome_notes text;

COMMIT;
