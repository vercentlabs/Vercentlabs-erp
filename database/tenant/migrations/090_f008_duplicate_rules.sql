BEGIN;

-- CRM vNext Prompt 3 continuation (CRM-VNEXT-044): F008-CAP-001/DEC-CRM-P1-F008
-- require admin-configurable duplicate-matching rules ("configurable rules"
-- named explicitly as required enterprise scope). Matching weights were
-- previously hardcoded across evaluateLeadDuplicateRisk/findAccountDuplicates/
-- findContactDuplicates.
--
-- Security design (explicit constraint: administrators must never be able to
-- write arbitrary SQL or executable expressions): a rule row is pure
-- structured data — (entity_type, signal, method) selects ONE of a small,
-- fixed, code-reviewed set of comparisons the application already knows how
-- to safely evaluate (DUPLICATE_SIGNAL_CATALOG in duplicate-rules.js); the
-- row only carries weight/threshold/enabled/blocking. There is no free-text
-- expression column anywhere in this table.
CREATE TABLE IF NOT EXISTS tenant.crm_duplicate_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  entity_type text NOT NULL CHECK (entity_type IN ('lead', 'contact', 'account')),
  signal text NOT NULL,
  method text NOT NULL CHECK (method IN ('exact', 'normalized', 'fuzzy')),
  weight integer NOT NULL DEFAULT 0 CHECK (weight BETWEEN 0 AND 100),
  fuzzy_threshold numeric(3, 2) CHECK (fuzzy_threshold IS NULL OR (fuzzy_threshold > 0 AND fuzzy_threshold <= 1)),
  enabled boolean NOT NULL DEFAULT true,
  blocking boolean NOT NULL DEFAULT false,
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, entity_type, signal, method)
);

CREATE INDEX IF NOT EXISTS crm_duplicate_rules_lookup_idx
  ON tenant.crm_duplicate_rules(organization_id, entity_type, enabled);

ALTER TABLE tenant.crm_duplicate_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.crm_duplicate_rules FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_organization_isolation
  ON tenant.crm_duplicate_rules;
CREATE POLICY tenant_organization_isolation
  ON tenant.crm_duplicate_rules
  USING (organization_id = current_setting('app.current_organization_id', true)::uuid)
  WITH CHECK (organization_id = current_setting('app.current_organization_id', true)::uuid);

CREATE OR REPLACE FUNCTION tenant.crm_duplicate_rules_touch()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    NEW.updated_at := now();
    IF NEW.weight IS DISTINCT FROM OLD.weight
      OR NEW.method IS DISTINCT FROM OLD.method
      OR NEW.enabled IS DISTINCT FROM OLD.enabled
      OR NEW.blocking IS DISTINCT FROM OLD.blocking
      OR NEW.fuzzy_threshold IS DISTINCT FROM OLD.fuzzy_threshold
    THEN
      NEW.version := OLD.version + 1;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS crm_duplicate_rules_touch ON tenant.crm_duplicate_rules;
CREATE TRIGGER crm_duplicate_rules_touch
BEFORE UPDATE ON tenant.crm_duplicate_rules
FOR EACH ROW EXECUTE FUNCTION tenant.crm_duplicate_rules_touch();

-- Seed defaults matching the PRE-EXISTING hardcoded weights exactly, so
-- enabling this table changes nothing about current detection behavior
-- until an administrator actually edits a rule (backward compatibility,
-- per the continuation's own instruction). ON CONFLICT DO NOTHING keeps
-- this idempotent and non-destructive of any rule an admin already edited.
INSERT INTO tenant.crm_duplicate_rules
  (organization_id, entity_type, signal, method, weight, enabled, blocking)
SELECT organizations.id, entity_type, signal, method, weight, true, blocking
FROM public.organizations
CROSS JOIN (VALUES
  ('lead', 'email', 'exact', 70, true),
  ('lead', 'mobile', 'normalized', 55, true),
  ('lead', 'name_and_company', 'normalized', 30, false),
  ('contact', 'email', 'exact', 70, true),
  ('contact', 'mobile', 'normalized', 55, true),
  ('contact', 'name', 'normalized', 30, false),
  ('account', 'gstin', 'exact', 70, true),
  ('account', 'pan', 'exact', 45, false),
  ('account', 'legal_name', 'normalized', 35, false)
) AS defaults(entity_type, signal, method, weight, blocking)
ON CONFLICT (organization_id, entity_type, signal, method) DO NOTHING;

COMMENT ON TABLE tenant.crm_duplicate_rules
  IS 'F008: governed, structured (never free-text/executable) duplicate-matching rule configuration per organization. See duplicate-rules.js DUPLICATE_SIGNAL_CATALOG for the fixed set of (entity_type, signal, method) comparisons a rule row may reference.';

COMMIT;
