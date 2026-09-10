BEGIN;

-- CRM Home's "high priority Leads" attention signal (Prompt 4 §51) filters
-- on lead_grade — index it the same way the qualification-state dashboard
-- filter already is, so the count stays an index scan, not a sequential
-- scan, as Lead volume grows.
CREATE INDEX IF NOT EXISTS crm_leads_grade_idx
  ON tenant.crm_leads(organization_id, lead_grade, updated_at DESC)
  WHERE record_status='active';

COMMIT;
