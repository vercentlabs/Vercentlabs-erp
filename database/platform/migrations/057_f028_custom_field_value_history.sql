BEGIN;

-- F028 Custom fields: custom_field_values is upserted in place, so every edit
-- erased the previous value with no trace. This append-only ledger keeps each
-- change (previous and new value, the field's key and label as they were at
-- the time, who and when), so historical values survive later edits, label
-- changes and field deactivation. Rows cannot be updated or deleted except
-- by cascades from the parent organization or definition.
CREATE TABLE IF NOT EXISTS custom_field_value_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  definition_id uuid NOT NULL REFERENCES custom_field_definitions(id) ON DELETE CASCADE,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  field_key text NOT NULL,
  field_label text NOT NULL,
  previous_value jsonb,
  new_value jsonb,
  changed_by uuid REFERENCES users(id) ON DELETE SET NULL,
  changed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS custom_field_value_history_entity_idx
  ON custom_field_value_history(organization_id, entity_id, changed_at DESC);

CREATE OR REPLACE FUNCTION custom_field_value_history_immutable()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Custom field value history is immutable'
    USING ERRCODE = 'check_violation';
END;
$$;

DROP TRIGGER IF EXISTS custom_field_value_history_immutable ON custom_field_value_history;
CREATE TRIGGER custom_field_value_history_immutable
BEFORE UPDATE OR DELETE ON custom_field_value_history
FOR EACH ROW EXECUTE FUNCTION custom_field_value_history_immutable();

COMMIT;
