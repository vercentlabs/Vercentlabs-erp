BEGIN;

-- POS Session 3, Phase 2 (docs/03-modules/point-of-sale/
-- POS_IMPLEMENTATION_TRACKER.md): every POS domain function so far filtered
-- carts/shifts/sales by organization_id+company_id only -- an ordinary
-- cashier with pos.sale.create could read or mutate ANY cart/shift in the
-- company by guessing/enumerating its id, regardless of which physical
-- store they actually work at. There is no existing platform mechanism for
-- scoping a user to a specific SUB-company resource (the platform's own
-- membership_company_access/membership_branch_access tables -- see
-- database/platform/migrations/002_platform_foundation.sql -- scope to a
-- whole company or branch, not to one store inside a company), so this
-- adds the smallest analogous table for POS stores, living in the tenant
-- schema (unlike membership_*_access) because tenant.pos_stores itself is
-- tenant-schema data.
--
-- Deliberately permissive when unconfigured: assertPosStoreAccess()
-- (services/api/src/modules/point-of-sale/features/cart.js) only enforces
-- this once an organization has created at least one row here for the
-- company in question -- a single-store tenant that has never assigned
-- anyone to a store is completely unaffected (matches the existing
-- pos_settings-row-or-defaults fallback convention used elsewhere in this
-- module). A multi-store tenant that assigns cashiers to stores gets a
-- real, fail-closed boundary: assigned users may act on that store, nobody
-- else can, and pos.store.manage/organization_owner/system_administrator
-- always bypass it (the people who administer stores need to see all of
-- them).
CREATE TABLE IF NOT EXISTS tenant.pos_store_access (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  company_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  store_id uuid NOT NULL REFERENCES tenant.pos_stores(id) ON DELETE CASCADE,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, user_id, store_id)
);
CREATE INDEX IF NOT EXISTS pos_store_access_lookup_idx
  ON tenant.pos_store_access(organization_id, user_id, store_id);
-- assertPosStoreAccess()'s "has this company opted in at all" check.
CREATE INDEX IF NOT EXISTS pos_store_access_company_idx
  ON tenant.pos_store_access(organization_id, company_id);

-- Matches the RLS treatment every other POS table already has (migration
-- 113): organization isolation enforced at the database level too, not
-- only in application code, so a RESTRICTED (non-BYPASSRLS) runtime role
-- can never see or write another organization's assignment rows.
ALTER TABLE tenant.pos_store_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.pos_store_access FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pos_store_access_organization_isolation ON tenant.pos_store_access;
CREATE POLICY pos_store_access_organization_isolation ON tenant.pos_store_access
  USING (organization_id=tenant.current_organization_id())
  WITH CHECK (organization_id=tenant.current_organization_id());

COMMIT;
