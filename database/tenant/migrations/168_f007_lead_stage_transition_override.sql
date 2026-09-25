BEGIN;

-- F007 gap-closure (benchmark: "Lead stages and statuses in top ERPs") —
-- isElevatedLifecycleActor() already existed in application code with a
-- comment describing an intended elevated-permission override for moving a
-- Lead outside its configured transition graph, but no override capability
-- was ever built for transitionLeadStage() to actually use it against, and
-- no real API route ever called it. This gives F007 the same
-- override-governance shape already shipped for lead assignment (F005) and
-- lead qualification (F006): an elevated actor (organization owner or
-- crm.records.view_all) may move a Lead along a transition that has no
-- graph edge, or skip an edge's required-reason gate, but only with a
-- written justification of at least 3 characters, recorded permanently on
-- the immutable transition-event row — never as a standing Lead property.
ALTER TABLE tenant.crm_lead_stage_events
  ADD COLUMN IF NOT EXISTS override_used boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS override_reason text;

ALTER TABLE tenant.crm_lead_stage_events
  DROP CONSTRAINT IF EXISTS crm_lead_stage_events_override_reason_check,
  ADD CONSTRAINT crm_lead_stage_events_override_reason_check
    CHECK (
      (NOT override_used AND override_reason IS NULL)
      OR (override_used AND override_reason IS NOT NULL AND length(btrim(override_reason)) >= 3 AND length(override_reason) <= 1000)
    );

COMMENT ON COLUMN tenant.crm_lead_stage_events.override_used IS
  'True when this transition moved the Lead outside its configured directed graph or skipped a required-reason gate, via the governed elevated-actor override path (F007).';

COMMIT;
