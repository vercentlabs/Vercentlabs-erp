BEGIN;

-- CRM role hierarchy correction.
--
-- 1. Sales-team scope: every CRM list/count/report now checks "is the
--    record's owner an active member of a team the caller manages"
--    (crm-access-scope.js). crm_sales_team_members already has
--    (organization_id,user_id,status); this adds the manager side.
CREATE INDEX IF NOT EXISTS crm_sales_teams_manager_idx
  ON tenant.crm_sales_teams (organization_id, manager_user_id, status);

-- 2. Minimal Account ownership. business_parties is shared with Sales and
--    had no owner, so every CRM user in a company could open every Account.
--    owner_user_id is nullable and NULL means "shared account": existing
--    Accounts stay NULL (visible exactly as before) — ownership is never
--    fabricated; it is set deliberately from the Account form.
ALTER TABLE tenant.business_parties
  ADD COLUMN IF NOT EXISTS owner_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS business_parties_owner_idx
  ON tenant.business_parties (organization_id, owner_user_id)
  WHERE owner_user_id IS NOT NULL;

-- Standalone Contacts (no Account) are scoped by who created them.
CREATE INDEX IF NOT EXISTS contacts_standalone_created_by_idx
  ON tenant.contacts (organization_id, created_by)
  WHERE party_id IS NULL;

COMMIT;
