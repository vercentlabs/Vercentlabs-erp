BEGIN;

-- F009 gap-closure (benchmark: "Opportunity management in top ERPs" report)
-- — every one of the 7 competitors reviewed (Salesforce, Dynamics 365, SAP,
-- NetSuite, Zoho, HubSpot, Odoo) treats a closed Opportunity/Deal as
-- reversible; Vercentlabs already supports a governed Won/Lost "reopen"
-- (migration 078), but the Archived state — set via the generic
-- archive/soft-delete action, not a pipeline stage — has always been a true
-- dead end: once archived, an Opportunity can never move stage or be edited
-- again by anyone. This migration only extends the probability-history
-- source CHECK so a restore-from-archive event can be distinguished from a
-- Won/Lost "reopen" in the audit trail; restoreOpportunity (opportunity-
-- transitions.js) reuses the exact same governed session-flag/trigger
-- mechanism migration 098 already put in place — no new table or trigger.
ALTER TABLE tenant.crm_opportunity_probability_history
  DROP CONSTRAINT IF EXISTS crm_opportunity_probability_history_source_check;
ALTER TABLE tenant.crm_opportunity_probability_history
  ADD CONSTRAINT crm_opportunity_probability_history_source_check
  CHECK (source IS NULL OR source IN (
    'manual_override', 'stage_default', 'terminal_won', 'terminal_lost', 'reopen', 'restored'
  ));

COMMIT;
