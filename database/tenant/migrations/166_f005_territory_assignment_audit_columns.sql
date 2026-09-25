BEGIN;

-- F005 gap-closure follow-on — the generic CRM resource-mutation-service
-- (crm-data-operations-and-customization/resource-mutation-service.js)
-- unconditionally writes created_by/updated_by on every INSERT and
-- updated_by/updated_at=now() on every UPDATE, for every resource it
-- serves. tenant.crm_territory_assignments never got these two columns
-- when it was created (migration 003), which meant the "territory-
-- assignments" resource — already wired into the real Territories &
-- Sales Teams settings screen (features/crm/settings/territories) via
-- this exact generic path — has been unable to create or update a single
-- row since the screen shipped: every attempt fails with a Postgres
-- "column updated_by does not exist" error. Discovered while seeding F005
-- demo data (a territory-mode assignment rule needs a real territory
-- member row), not by the settings screen itself, but the bug is in the
-- shared table, not the seed script.
ALTER TABLE tenant.crm_territory_assignments
  ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

COMMIT;
