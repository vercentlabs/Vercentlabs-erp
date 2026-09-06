BEGIN;

-- F029 gap: no cancellation capability existed for an in-flight or queued
-- CRM Lead bulk job. 052_background_jobs.sql deliberately dropped a
-- 'cancelled' status because nothing could ever set it; this is the
-- additive migration that comment said would be needed "the day a real
-- cancellation feature needs them".
ALTER TABLE tenant.background_jobs DROP CONSTRAINT IF EXISTS background_jobs_status_check;
ALTER TABLE tenant.background_jobs
  ADD CONSTRAINT background_jobs_status_check
  CHECK (status IN ('pending', 'processing', 'completed', 'dead', 'cancelled'));

COMMIT;
