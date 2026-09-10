BEGIN;

-- F011 integrity closeout (Prompts 1-5): crm_opportunity_probability_history
-- had no way to record *why* a probability changed. moveOpportunityStage
-- was found to change probability (adopting the destination stage's
-- configured default, or forcing 0/100 on Won/Lost/reopen) without ever
-- writing a probability-history row at all — a real F011 completeness gap:
-- an Opportunity moved through several stages showed zero probability
-- history unless a manual override also happened. This column lets every
-- future row declare its provenance explicitly; historical rows predate
-- this column and cannot be retroactively classified, so they stay NULL
-- (an honest "unknown/legacy" marker) rather than being guessed at.
ALTER TABLE tenant.crm_opportunity_probability_history
  ADD COLUMN IF NOT EXISTS source text
    CHECK (source IS NULL OR source IN (
      'manual_override', 'stage_default', 'terminal_won', 'terminal_lost', 'reopen'
    ));

CREATE INDEX IF NOT EXISTS crm_opportunity_probability_history_source_idx
  ON tenant.crm_opportunity_probability_history(organization_id, opportunity_id, source);

COMMIT;
