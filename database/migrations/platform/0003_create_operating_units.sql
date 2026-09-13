-- SP003: branch/site/operating-unit context. Deliberately generic - warehouse,
-- plant, project and store are module-specific concepts that must reference
-- an operating unit, never duplicate this table.
CREATE TABLE platform.operating_units (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES platform.organizations (id) ON DELETE RESTRICT,
  company_id UUID NOT NULL REFERENCES platform.companies (id) ON DELETE RESTRICT,
  unit_code TEXT NOT NULL,
  name TEXT NOT NULL,
  unit_type TEXT NOT NULL,
  parent_operating_unit_id UUID REFERENCES platform.operating_units (id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'DRAFT',
  status_reason TEXT,
  time_zone TEXT NOT NULL,
  address JSONB,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  CONSTRAINT operating_units_company_code_key UNIQUE (company_id, unit_code),
  CONSTRAINT operating_units_status_check
    CHECK (status IN ('DRAFT', 'ACTIVE', 'INACTIVE', 'CLOSED')),
  CONSTRAINT operating_units_type_check
    CHECK (unit_type IN ('BRANCH', 'SITE', 'OPERATING_UNIT')),
  CONSTRAINT operating_units_code_format_check
    CHECK (unit_code ~ '^[A-Z0-9](?:[A-Z0-9_-]{0,30}[A-Z0-9])?$'),
  CONSTRAINT operating_units_name_not_blank_check CHECK (btrim(name) <> ''),
  CONSTRAINT operating_units_no_self_parent_check
    CHECK (parent_operating_unit_id IS NULL OR parent_operating_unit_id <> id),
  CONSTRAINT operating_units_version_positive_check CHECK (version >= 1)
);

CREATE INDEX operating_units_organization_id_idx ON platform.operating_units (organization_id);
CREATE INDEX operating_units_company_id_idx ON platform.operating_units (company_id);
CREATE INDEX operating_units_parent_idx ON platform.operating_units (parent_operating_unit_id);
CREATE INDEX operating_units_status_idx ON platform.operating_units (status);

-- Cross-row consistency that a single-table CHECK constraint cannot express:
-- the unit's organization_id must match its company's organization_id, and
-- (when a parent is set) the parent must belong to the same company and
-- organization, with no cycle in the parent chain.
CREATE OR REPLACE FUNCTION platform.enforce_operating_unit_consistency()
RETURNS TRIGGER AS $$
DECLARE
  company_org UUID;
  parent_org UUID;
  parent_company UUID;
  cursor_id UUID;
  depth INTEGER := 0;
BEGIN
  SELECT organization_id INTO company_org
  FROM platform.companies WHERE id = NEW.company_id;

  IF company_org IS NULL THEN
    RAISE EXCEPTION 'company_id % does not exist', NEW.company_id;
  END IF;

  IF company_org <> NEW.organization_id THEN
    RAISE EXCEPTION 'operating unit organization_id must match its company''s organization_id';
  END IF;

  IF NEW.parent_operating_unit_id IS NOT NULL THEN
    SELECT organization_id, company_id INTO parent_org, parent_company
    FROM platform.operating_units WHERE id = NEW.parent_operating_unit_id;

    IF parent_org IS NULL THEN
      RAISE EXCEPTION 'parent_operating_unit_id % does not exist', NEW.parent_operating_unit_id;
    END IF;

    IF parent_org <> NEW.organization_id OR parent_company <> NEW.company_id THEN
      RAISE EXCEPTION 'parent operating unit must belong to the same organization and company';
    END IF;

    cursor_id := NEW.parent_operating_unit_id;
    WHILE cursor_id IS NOT NULL LOOP
      IF cursor_id = NEW.id THEN
        RAISE EXCEPTION 'operating unit parent hierarchy would contain a cycle';
      END IF;
      depth := depth + 1;
      IF depth > 100 THEN
        RAISE EXCEPTION 'operating unit parent hierarchy exceeds maximum depth';
      END IF;
      SELECT parent_operating_unit_id INTO cursor_id
      FROM platform.operating_units WHERE id = cursor_id;
    END LOOP;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER operating_units_consistency_trigger
  BEFORE INSERT OR UPDATE OF organization_id, company_id, parent_operating_unit_id
  ON platform.operating_units
  FOR EACH ROW
  EXECUTE FUNCTION platform.enforce_operating_unit_consistency();

COMMENT ON TABLE platform.operating_units IS
  'SP003 branch/site/operating-unit context. unit_code is immutable and unique within its company; no physical delete.';
