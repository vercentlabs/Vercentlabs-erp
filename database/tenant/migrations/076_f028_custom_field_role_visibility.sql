BEGIN;

-- F028 CAP-002: custom field definitions had no field-level role-visibility
-- mechanism — once a field existed, anyone with ordinary record access saw
-- it. Adds an opt-in allowlist: NULL/empty means visible to everyone
-- (unchanged default behavior), a non-empty array restricts the field to
-- only the listed role slugs (organization_owner always sees everything,
-- consistent with every other sensitivity gate in this module).

ALTER TABLE tenant.crm_custom_field_definitions
  ADD COLUMN IF NOT EXISTS visible_to_roles text[];

COMMENT ON COLUMN tenant.crm_custom_field_definitions.visible_to_roles IS
  'NULL or empty = visible to every role with ordinary record access. A non-empty array restricts the field (definition and stored value) to only the listed role slugs, plus organization_owner.';

COMMIT;
