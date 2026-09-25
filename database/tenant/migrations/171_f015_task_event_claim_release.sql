BEGIN;

-- F015 Tasks: claimCrmTask/releaseCrmTask (team-queue claim, F015 stage A2)
-- write event_type 'claimed' / 'released' into crm_task_events, but migration
-- 071's CHECK only allowed created/updated/started/completed/cancelled — so
-- every real claim or release raised 23514 and rolled back. The unit tests
-- mock the client and never met the constraint; found by live verification.
ALTER TABLE tenant.crm_task_events
  DROP CONSTRAINT IF EXISTS crm_task_events_event_type_check;
ALTER TABLE tenant.crm_task_events
  ADD CONSTRAINT crm_task_events_event_type_check
  CHECK (event_type IN ('created','updated','started','completed','cancelled','claimed','released'));

COMMIT;
