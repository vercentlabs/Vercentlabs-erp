-- Item Categories.
--
-- One hierarchy (tenant.item_groups, shown as Categories) classifies every item for Sales, Procurement, Inventory, Finance and reporting.
-- There is no separate group, sub-group or sales / procurement category. This migration adds:
--
-- 1. Category fields: sibling order, the item types a category allows, an icon, and default Inventory and Accounting profiles.
-- 2. Hierarchy safety in the database: a category's parent is never itself or one of its own descendants, whoever writes the row;
--    sibling names are unique (the same name may repeat under different parents).
-- 3. Item accounting profiles, owned by Finance: an Inventory profile (inventory asset and receipt clearing / GRNI accounts) and an
--    Accounting profile (COGS, expense, revenue, purchase price variance). A category suggests them; an item keeps the profiles it
--    was given, so changing a category never silently changes how existing items post.
-- 4. A record of deleted categories (the category and its history go; the deletion is kept).
-- 5. Permissions: delete categories, reclassify items, and the inventory, accounting and tax defaults of categories.

-- ============================================================ 3. item accounting profiles (first: categories and items refer to them)

CREATE TABLE IF NOT EXISTS tenant.accounting_item_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  profile_kind text NOT NULL CHECK (profile_kind IN ('inventory', 'accounting')),
  code text NOT NULL CHECK (code ~ '^[A-Z0-9][A-Z0-9._/-]{0,39}$'),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  description text,
  inventory_account_id uuid,
  clearing_account_id uuid,
  cogs_account_id uuid,
  expense_account_id uuid,
  revenue_account_id uuid,
  variance_account_id uuid,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- An inventory profile names inventory accounts only; an accounting profile only the profit-and-loss side.
  CHECK (profile_kind <> 'inventory' OR (cogs_account_id IS NULL AND expense_account_id IS NULL AND revenue_account_id IS NULL AND variance_account_id IS NULL)),
  CHECK (profile_kind <> 'accounting' OR (inventory_account_id IS NULL AND clearing_account_id IS NULL)),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, inventory_account_id) REFERENCES tenant.accounting_accounts (organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, clearing_account_id) REFERENCES tenant.accounting_accounts (organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, cogs_account_id) REFERENCES tenant.accounting_accounts (organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, expense_account_id) REFERENCES tenant.accounting_accounts (organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, revenue_account_id) REFERENCES tenant.accounting_accounts (organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, variance_account_id) REFERENCES tenant.accounting_accounts (organization_id, id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX IF NOT EXISTS accounting_item_profiles_code_uidx ON tenant.accounting_item_profiles (organization_id, upper(code));

-- ============================================================ 1. category fields

ALTER TABLE tenant.item_groups
  ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS allowed_item_types text[],
  ADD COLUMN IF NOT EXISTS icon_attachment_id uuid,
  ADD COLUMN IF NOT EXISTS default_inventory_profile_id uuid,
  ADD COLUMN IF NOT EXISTS default_accounting_profile_id uuid;

ALTER TABLE tenant.item_groups
  ADD CONSTRAINT item_groups_allowed_types_check CHECK (allowed_item_types IS NULL
    OR (cardinality(allowed_item_types) BETWEEN 1 AND 3 AND allowed_item_types <@ ARRAY['stock', 'non_stock', 'service']::text[])),
  ADD CONSTRAINT item_groups_sort_order_check CHECK (sort_order BETWEEN -100000 AND 100000),
  ADD CONSTRAINT item_groups_inventory_profile_fkey FOREIGN KEY (organization_id, default_inventory_profile_id)
    REFERENCES tenant.accounting_item_profiles (organization_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT item_groups_accounting_profile_fkey FOREIGN KEY (organization_id, default_accounting_profile_id)
    REFERENCES tenant.accounting_item_profiles (organization_id, id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS item_groups_parent_idx ON tenant.item_groups (organization_id, parent_id, sort_order);
CREATE INDEX IF NOT EXISTS item_groups_name_idx ON tenant.item_groups (organization_id, lower(name));
-- Siblings carry distinct names; "Accessories" may still appear under two different parents.
CREATE UNIQUE INDEX IF NOT EXISTS item_groups_sibling_name_uidx
  ON tenant.item_groups (organization_id, COALESCE(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(btrim(name)));

-- Items keep the profiles they were given.
ALTER TABLE tenant.items
  ADD COLUMN IF NOT EXISTS inventory_profile_id uuid,
  ADD COLUMN IF NOT EXISTS accounting_profile_id uuid;
ALTER TABLE tenant.items
  ADD CONSTRAINT items_inventory_profile_fkey FOREIGN KEY (organization_id, inventory_profile_id) REFERENCES tenant.accounting_item_profiles (organization_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT items_accounting_profile_fkey FOREIGN KEY (organization_id, accounting_profile_id) REFERENCES tenant.accounting_item_profiles (organization_id, id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS items_category_idx ON tenant.items (organization_id, group_id) WHERE group_id IS NOT NULL;

-- ============================================================ 2. hierarchy safety

-- A parent is never the category itself nor one of its descendants, and never another organization's: checked on every write, under
-- a per-organization lock so two simultaneous moves cannot together create a cycle.
CREATE OR REPLACE FUNCTION tenant.item_groups_hierarchy_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  cursor_id uuid := NEW.parent_id;
  depth integer := 0;
BEGIN
  IF NEW.parent_id IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND NEW.parent_id IS NOT DISTINCT FROM OLD.parent_id THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('item_groups_hierarchy:' || NEW.organization_id::text));
  IF NEW.parent_id = NEW.id THEN RAISE EXCEPTION 'A category cannot be its own parent.' USING ERRCODE = 'check_violation', CONSTRAINT = 'item_groups_parent_not_self_check'; END IF;
  WHILE cursor_id IS NOT NULL LOOP
    IF cursor_id = NEW.id THEN
      RAISE EXCEPTION 'The selected parent is already a descendant of this category.' USING ERRCODE = 'check_violation', CONSTRAINT = 'item_groups_hierarchy_cycle';
    END IF;
    depth := depth + 1;
    IF depth > 50 THEN RAISE EXCEPTION 'Categories nest at most 50 levels deep.' USING ERRCODE = 'check_violation', CONSTRAINT = 'item_groups_hierarchy_depth'; END IF;
    SELECT parent_id INTO cursor_id FROM tenant.item_groups WHERE organization_id = NEW.organization_id AND id = cursor_id;
  END LOOP;
  RETURN NEW;
END;
$$;
CREATE TRIGGER item_groups_hierarchy_guard BEFORE INSERT OR UPDATE OF parent_id ON tenant.item_groups
  FOR EACH ROW EXECUTE FUNCTION tenant.item_groups_hierarchy_guard();

-- ============================================================ 4. deleted categories

CREATE TABLE IF NOT EXISTS tenant.item_category_deletions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  category_id uuid NOT NULL,
  code text NOT NULL,
  name text NOT NULL,
  parent_id uuid,
  reason text,
  deleted_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  deleted_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS item_category_deletions_idx ON tenant.item_category_deletions (organization_id, deleted_at DESC);

DO $$
DECLARE name text;
BEGIN
  FOREACH name IN ARRAY ARRAY['accounting_item_profiles', 'item_category_deletions'] LOOP
    EXECUTE format('ALTER TABLE tenant.%I ENABLE ROW LEVEL SECURITY', name);
    EXECUTE format('ALTER TABLE tenant.%I FORCE ROW LEVEL SECURITY', name);
    EXECUTE format('CREATE POLICY organization_isolation ON tenant.%I USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id())', name);
    EXECUTE format('GRANT SELECT ON tenant.%I TO vercent_worker', name);
  END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE ON tenant.accounting_item_profiles TO vercent_app;
GRANT SELECT, INSERT ON tenant.item_category_deletions TO vercent_app;
-- A category nobody uses may be deleted (its history goes with it; the deletion is recorded above).
GRANT DELETE ON tenant.item_groups TO vercent_app;

-- ============================================================ 5. permissions

INSERT INTO public.permissions (key, name, category, description) VALUES
  ('products.delete_categories', 'Delete unused categories', 'Products', 'Permanently delete an item category nothing uses.'),
  ('products.reclassify', 'Reclassify items', 'Products', 'Move an item to another category.'),
  ('products.category_inventory_defaults', 'Manage category inventory defaults', 'Products', 'Set a category''s default inventory profile and valuation method.'),
  ('products.category_accounting_defaults', 'Manage category accounting defaults', 'Products', 'Set a category''s default accounting profile.'),
  ('products.category_tax_defaults', 'Manage category tax defaults', 'Products', 'Set a category''s default tax profile and HSN / SAC.')
ON CONFLICT (key) DO NOTHING;

-- Whoever manages categories may delete unused ones, reclassify items and set inventory and tax defaults.
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT DISTINCT existing.role_id, permission.key
  FROM public.role_permissions existing
  JOIN public.permissions permission ON permission.key IN ('products.delete_categories', 'products.reclassify', 'products.category_inventory_defaults', 'products.category_tax_defaults')
 WHERE existing.permission_key = 'products.manage_categories'
ON CONFLICT DO NOTHING;
-- Accounting defaults are Finance's: whoever administers accounting settings.
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT DISTINCT existing.role_id, 'products.category_accounting_defaults'
  FROM public.role_permissions existing WHERE existing.permission_key = 'accounting.settings.manage'
ON CONFLICT DO NOTHING;
-- Reclassifying is an ordinary item edit for whoever edits items.
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT DISTINCT existing.role_id, 'products.reclassify'
  FROM public.role_permissions existing WHERE existing.permission_key = 'products.edit_inventory'
ON CONFLICT DO NOTHING;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0058_item_categories.sql', 'item-categories');
