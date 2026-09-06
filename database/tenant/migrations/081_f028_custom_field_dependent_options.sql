BEGIN;

-- F028 gap: a select/multi_select custom field's `options` was always a flat
-- array, with no way to make one field's valid options depend on another
-- field's selected value (e.g. State options narrowed by a Country field).
-- When depends_on_field_key is set, `options` is interpreted as a JSON
-- object mapping the parent field's value to its array of allowed child
-- values instead of a flat array — enforced in validateCustomRecord
-- (services/api/src/modules/crm/index.js), not here; this migration only
-- adds the reference and guards it can't point at a nonexistent sibling
-- field or at itself.
ALTER TABLE tenant.crm_custom_field_definitions
  ADD COLUMN IF NOT EXISTS depends_on_field_key text;

ALTER TABLE tenant.crm_custom_field_definitions
  ADD CONSTRAINT crm_custom_field_definitions_depends_on_not_self_check
  CHECK (depends_on_field_key IS NULL OR depends_on_field_key <> field_key);

-- NULL in any FK column satisfies a MATCH SIMPLE foreign key regardless of
-- the other columns, so a field with no dependency (the common case) is
-- unaffected. A field WITH a dependency must reference a real field_key on
-- the exact same custom object.
ALTER TABLE tenant.crm_custom_field_definitions
  ADD CONSTRAINT crm_custom_field_definitions_depends_on_fkey
  FOREIGN KEY (organization_id, object_definition_id, depends_on_field_key)
  REFERENCES tenant.crm_custom_field_definitions(organization_id, object_definition_id, field_key)
  ON DELETE SET NULL (depends_on_field_key);

COMMIT;
