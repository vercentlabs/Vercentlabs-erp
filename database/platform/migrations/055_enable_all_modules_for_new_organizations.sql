BEGIN;

-- Bug: an organisation created through self-serve registration (registerOrganization) had NO organization_modules
-- rows at all, so every module resolved as "disabled" and the founding admin saw a locked sidebar. Migration 028 only
-- backfilled organisations that existed at the time. Every new organisation now gets all 12 released modules enabled
-- by a trigger (same pattern as the subscription trigger), and existing organisations with missing or never-enabled
-- rows are repaired. A module an administrator deliberately disabled (enabled_at set) is left alone.
CREATE OR REPLACE FUNCTION ensure_organization_modules()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO organization_modules (organization_id, module_key, name, status, enabled_at)
  VALUES
    (NEW.id, 'crm', 'CRM', 'enabled', now()), (NEW.id, 'sales', 'Sales', 'enabled', now()),
    (NEW.id, 'accounting', 'Accounting', 'enabled', now()), (NEW.id, 'procurement', 'Procurement', 'enabled', now()),
    (NEW.id, 'stock', 'Stock', 'enabled', now()), (NEW.id, 'manufacturing', 'Manufacturing', 'enabled', now()),
    (NEW.id, 'projects', 'Projects', 'enabled', now()), (NEW.id, 'assets', 'Assets', 'enabled', now()),
    (NEW.id, 'point-of-sale', 'Point of Sale', 'enabled', now()), (NEW.id, 'quality', 'Quality', 'enabled', now()),
    (NEW.id, 'support', 'Support', 'enabled', now()), (NEW.id, 'hr-payroll', 'HR & Payroll', 'enabled', now())
  ON CONFLICT (organization_id, module_key) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS organizations_ensure_modules ON organizations;
CREATE TRIGGER organizations_ensure_modules AFTER INSERT ON organizations
  FOR EACH ROW EXECUTE FUNCTION ensure_organization_modules();

WITH module_seed(module_key, name) AS (
  VALUES ('crm','CRM'),('sales','Sales'),('accounting','Accounting'),('procurement','Procurement'),('stock','Stock'),
         ('manufacturing','Manufacturing'),('projects','Projects'),('assets','Assets'),('point-of-sale','Point of Sale'),
         ('quality','Quality'),('support','Support'),('hr-payroll','HR & Payroll')
)
INSERT INTO organization_modules (organization_id, module_key, name, status, enabled_at)
SELECT o.id, s.module_key, s.name, 'enabled', now() FROM organizations o CROSS JOIN module_seed s
ON CONFLICT (organization_id, module_key) DO NOTHING;

UPDATE organization_modules SET status = 'enabled', enabled_at = now(), updated_at = now()
WHERE status IN ('registered', 'disabled') AND enabled_at IS NULL;

COMMIT;
