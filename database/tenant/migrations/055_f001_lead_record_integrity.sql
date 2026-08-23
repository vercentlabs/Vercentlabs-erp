BEGIN;

-- F001 — Leads: enforce the two record invariants at the database boundary for
-- every write path (web CRUD, imports, integrations and offline sync). NOT VALID
-- deliberately avoids rejecting a deployment because of legacy rows while still
-- enforcing the constraints for all new/changed rows immediately.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'tenant.crm_leads'::regclass
      AND conname = 'crm_leads_first_name_present_check'
  ) THEN
    ALTER TABLE tenant.crm_leads
      ADD CONSTRAINT crm_leads_first_name_present_check
      CHECK (btrim(first_name) <> '') NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'tenant.crm_leads'::regclass
      AND conname = 'crm_leads_contact_method_present_check'
  ) THEN
    ALTER TABLE tenant.crm_leads
      ADD CONSTRAINT crm_leads_contact_method_present_check
      CHECK (
        NULLIF(btrim(COALESCE(email, '')), '') IS NOT NULL
        OR NULLIF(btrim(COALESCE(mobile, '')), '') IS NOT NULL
        OR NULLIF(btrim(COALESCE(phone, '')), '') IS NOT NULL
      ) NOT VALID;
  END IF;
END $$;

COMMIT;
