BEGIN;

-- F026 Won / lost reasons: crm_opportunity_stage_history is the durable record
-- of every close (status, reason id, reason label snapshot, notes) and every
-- reopen (reason in note). It was append-only only by convention — any
-- UPDATE or DELETE with table access could rewrite why a deal was won or
-- lost. Enforce it in the database, as crm_sales_stage_configuration_history
-- already does. Deletes cascaded from a parent (opportunity or organization
-- removal) run inside the foreign-key trigger (pg_trigger_depth() > 1) and
-- remain allowed, so tenant offboarding still works.
CREATE OR REPLACE FUNCTION tenant.crm_opportunity_stage_history_immutable_f026()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Opportunity stage and outcome history is immutable'
    USING ERRCODE = 'check_violation';
END;
$$;

DROP TRIGGER IF EXISTS crm_opportunity_stage_history_immutable_f026
  ON tenant.crm_opportunity_stage_history;
CREATE TRIGGER crm_opportunity_stage_history_immutable_f026
BEFORE UPDATE OR DELETE ON tenant.crm_opportunity_stage_history
FOR EACH ROW EXECUTE FUNCTION tenant.crm_opportunity_stage_history_immutable_f026();

COMMIT;
